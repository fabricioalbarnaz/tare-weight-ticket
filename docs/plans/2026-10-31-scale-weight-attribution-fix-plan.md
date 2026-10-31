# Sinalizar leituras de peso suspeitas (cruzamento entrada/saída entre caminhões)

Status: **Nenhum passo iniciado — ajuste combinado para depois com o usuário (2026-10-31).**
Created: 2026-10-31

## Context — o incidente que motivou este plano

Em 2026-10-31, por volta de 12:25–12:28 (horário do servidor), o peso de
entrada do ticket do caminhão **MLX7A45** foi gravado como **20940 kg**,
mas o peso real observado no pátio foi **16240 kg**. Investigação em
`data/tare.sqlite` (tabelas `raw_events`, `tickets`, `ticket_audit_log`)
reconstruiu a sequência real:

| Horário (recebido no servidor) | Evento | Peso obtido | Ticket |
|---|---|---|---|
| 12:25:48 (POST) → 12:25:54 (resolve, 6,5s, 1ª tentativa) | saída de **RXK8B39** | **16240 kg** | #257 (`ANOMALY` — sem entrada aberta) |
| 12:26:23 (POST) → 12:27:34 (resolve, **70,27s**, só na **3ª tentativa**, após 2 timeouts de estabilidade de 30s) | entrada de **MLX7A45** | **20940 kg** | #258 (`OPEN`) |
| 12:27:34 (POST) → 12:27:34 (resolve, 0,5s, 1ª tentativa) | saída de **IXB4J88** | **20940 kg** | #256 (`CLOSED`, net = 38040 kg, coerente com a entrada de 58980 kg registrada ~22 min antes) |

Causa raiz: `scale/tcp-client.ts` serializa as leituras da balança numa
fila única (`readQueue`) e cada chamada de `readStableWeight()` recebe
simplesmente **a próxima leitura estável que a balança emitir** — sem
nenhuma verificação de que a placa daquele webhook é o caminhão
fisicamente presente na balança naquele momento. Isso funciona só
enquanto a ordem de chegada dos webhooks na fila coincide com a ordem
real em que os caminhões cruzam a balança.

Neste incidente específico:
1. O MLX7A45 subiu na balança e estabilizou em 16240 kg. O webhook de
   **saída** do RXK8B39 — que chegou ao servidor primeiro — estava na
   frente da fila e recebeu essa leitura, virando uma `ANOMALY` (RXK8B39
   nunca teve entrada registrada neste sistema).
2. O webhook de **entrada** do MLX7A45 só chegou ao servidor ~35s depois
   (atraso de reconhecimento ANPR / upload de imagem da câmera). Quando
   finalmente entrou na fila, o MLX7A45 já tinha sido liberado (o sinal
   de liberação do motorista já havia disparado junto da leitura roubada
   pelo RXK8B39). A leitura ficou **70,27s** esperando uma nova
   estabilização — 2 timeouts completos de 30s (default de
   `stabilityTimeoutMs`) antes de conseguir uma na 3ª tentativa.
3. Nesse intervalo de 70s, o **IXB4J88** (ticket já aberto há ~22 min,
   entrada de 58980 kg) subiu na balança para pesar a saída, estabilizando
   em 20940 kg — leitura que o webhook de entrada do MLX7A45, ainda
   pendente na fila, capturou.
4. 0,5s depois, o webhook de saída do IXB4J88 chegou e, como a balança já
   estava estável no mesmo valor, confirmou 20940 kg quase
   instantaneamente — valor coerente com o net weight do IXB4J88
   (58980 − 20940 = 38040 kg), confirmando que 20940 kg é legitimamente o
   peso do IXB4J88, não do MLX7A45.

Sinal notável: as duas leituras "normais" (RXK8B39, IXB4J88) resolveram
na **1ª tentativa**, em menos de 7s. A leitura problemática (MLX7A45) só
resolveu na **3ª tentativa**, depois de 70s — ou seja, o próprio número de
tentativas necessárias já seria um indicador de que algo fora do comum
aconteceu durante aquela espera.

## Scope

Uma correlação robusta de verdade entre peso e evento de câmera (ex.:
casar por proximidade de timestamp entre o início do assentamento do peso
e o `receivedAt` do webhook, ou um sensor de presença físico independente
da câmera/ANPR) é uma reformulação grande de arquitetura — fora de escopo
para o volume atual (~200 caminhões/dia) e sem hardware novo disponível
hoje (ver master plan §7/§11 sobre hardware ainda pendente).

Este plano é mais cirúrgico: **não impedir** o cruzamento (isso exigiria a
reformulação acima), mas **detectar e sinalizar** a leitura suspeita para
revisão humana em vez de confiar nela ciegamente — usando o único sinal
que já temos de graça: quantas tentativas (`attemptsUsed`) foram
necessárias para obter a leitura.

Fora de escopo (não fazer neste plano):
- Qualquer redesenho de correlação peso↔câmera por timestamp/sensor de
  presença — fica para um plano futuro só se o volume de incidentes
  sinalizados por este plano justificar o investimento.
- Reduzir `stabilityRetryCount`/`stabilityTimeoutMs` — essa é a decisão
  deliberada do plano anterior
  (`docs/plans/2026-10-27-scale-capture-reliability-plan.md`, "nunca
  liberar sem peso capturado"); este plano não a contradiz, só adiciona
  visibilidade sobre leituras que precisaram de retry.
- Alertar o operador automaticamente em tempo real (push/som/tela) quando
  uma leitura for sinalizada como suspeita — já foi decidido antes como
  fora de escopo para o fluxo de falha de captura
  (`docs/plans/2026-10-27-scale-capture-reliability-plan.md`), e vale o
  mesmo aqui: a leitura some como item revisável no painel do admin, sem
  alerta automático.
- Corrigir retroativamente os tickets #257/#258 deste incidente — fica
  para quando o usuário decidir corrigir via Admin UI (fluxo manual já
  existente), fora deste plano de código.

## Steps

1. **Expor `attemptsUsed` no resultado da leitura da balança.**
   - `scale/types.ts`: adicionar `attemptsUsed?: number` em
     `ScaleReadResult`.
   - `scale/tcp-client.ts`: `readWithRetries` já sabe em qual tentativa
     (`attempt`) a leitura foi bem-sucedida (ou que todas as
     `stabilityRetryCount` falharam) — só precisa repassar esse número no
     resultado final em vez de descartá-lo.
   - `tcp-client.test.ts`: cobrir que `attemptsUsed` reflete
     corretamente sucesso na 1ª/2ª/3ª tentativa e o caso de falha total
     (esgotou todas).
   Status: não iniciado.

2. **Propagar para o audit log do ticket.**
   - `tickets/session-service.ts`: `EntranceReadingInput`/
     `ExitReadingInput` ganham `attemptsUsed?: number`; incluir esse
     campo no `payload` de `repo.appendAuditLog(...)` em todos os pontos
     que hoje já gravam `weightKg`/`cameraId` (entrada, saída, retrigger,
     anomaly, via tare — via tare não se aplica diretamente já que não
     chama a balança, mas o restante sim).
   - `camera/routes.ts`: repassar `attemptsUsed` vindo de
     `scaleClient.readStableWeight()` para `handleEntranceReading`/
     `handleExitReading`.
   - `session-service.test.ts`: confirmar que o audit log grava
     `attemptsUsed` corretamente.
   Status: não iniciado.

3. **Consulta administrativa para leituras suspeitas.**
   - `tickets/repository.ts`: nova função (nome provisório
     `listSuspectWeighings`), reaproveitando o padrão existente de
     `listUnresolvedEvents` — varre o audit log por entradas de
     `ENTRY_CAPTURED`/`EXIT_CAPTURED` (e variantes) com
     `attemptsUsed > 1`, dentro de uma janela de tempo (reaproveitar o
     parâmetro de período já usado em `listTickets`/busca histórica).
   - `admin/routes.ts` + `admin/schemas.ts`: novo endpoint (provisório
     `GET /api/admin/weighings/suspect`) ou, se for mais simples,
     estender a resposta de `GET /api/admin/status`/`listTickets` com um
     campo `suspectWeight: boolean` por ticket — decidir qual encaixa
     melhor olhando o formato de resposta já consumido pela Admin UI
     antes de implementar.
   - `admin/routes.test.ts`: cobrir o novo endpoint/campo.
   Status: não iniciado.

4. **Indicador na Admin UI.**
   - Reaproveitar os componentes de alerta/badge já usados no painel de
     status de hardware ou na busca histórica (`apps/admin-ui`) — sem
     criar uma tela nova — para marcar visualmente um ticket cuja leitura
     precisou de retry, com um tooltip/texto curto explicando o motivo
     (ex. "peso confirmado só na 3ª tentativa — confira se não houve
     cruzamento com outro caminhão").
   - Fluxo de correção continua sendo o manual já existente (PATCH
     `/tickets/:id/entry` ou `/exit`) — este passo é só visibilidade, não
     um botão de ação novo.
   - Testar manualmente no browser com `VITE_API_MODE=mock` e depois
     `proxy`, seguindo a diretriz do CLAUDE.md de validar mudanças de UI
     rodando a aplicação de fato.
   Status: não iniciado.

5. **Atualizar documentação.**
   - Master plan (`docs/plans/2026-09-29-tare-weight-ticket-plan.md`),
     §11: registrar a decisão e o novo campo/indicador, citando este
     incidente como motivação (sem incluir o `CLAUDE.md` "Project status"
     até o merge, seguindo o mesmo padrão do plano anterior).
   - `CLAUDE.md`: nota de "Project status" só depois de mergeado.
   Status: não iniciado.

6. **Verificar.**
   - `core-service` e `admin-ui`: lint/typecheck/test/build via container
     Alpine (comando documentado no `CLAUDE.md`), autoritativo.
   - Sanity nativo no Windows como checagem rápida adicional.
   Status: não iniciado.

## Open questions / riscos a observar

- **Falso positivo de "suspeito" não é sinônimo de "errado".** Uma leitura
  pode legitimamente precisar de 2-3 tentativas por motivos banais (truck
  grande demorando a assentar, ruído mecânico pontual) sem nenhum
  cruzamento real de caminhão. O indicador deve ser lido como "vale a pena
  checar", não como "está confirmado errado" — o texto/tooltip na Admin UI
  precisa deixar isso claro para não gerar trabalho de revisão
  desnecessário em excesso.
- **Decidir o formato da API (passo 3) antes de implementar**: campo
  embutido em `listTickets`/`status` vs. endpoint dedicado. Depende de
  como a Admin UI já estrutura essas chamadas hoje — checar
  `apps/admin-ui` antes de escolher, para não duplicar um padrão que já
  existe com outro nome.
- Este plano **não resolve** o cruzamento em si — só o torna visível mais
  rápido. Se, na prática, o volume de leituras sinalizadas como suspeitas
  for alto (ex. por conta do tráfego natural do pátio em horários de
  pico), isso é evidência de que vale investir na correlação por
  timestamp/sensor de presença mencionada na seção "Scope" como fora de
  escopo aqui.
