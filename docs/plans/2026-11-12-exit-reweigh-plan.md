# Exit re-weigh (correção de peso de saída sem nova entrada)

## Context

Hoje, uma leitura de saída sem ticket `OPEN` correspondente é **sempre**
marcada como `ANOMALY` (master plan §5) — nunca é adivinhada. Isso quebra um
fluxo real: o caminhão pesa a entrada e a saída normalmente, o ticket fecha
e imprime, mas percebe-se que carregou menos do que deveria. Ele dá a volta,
entra por **outro** portão (sem câmera de entrada / sem nova pesagem de
entrada), ajusta a carga, e pesa a saída de novo para corrigir o peso.

Decisão (conversa com o usuário, 2026-11-12): quando uma leitura de saída
chegar sem ticket `OPEN` para a placa, e existir um ticket `CLOSED` para a
**mesma placa** cuja saída ocorreu há menos de uma janela configurável
(default 2h), o sistema deve:
1. Reaproveitar o peso/horário de **entrada** desse ticket `CLOSED` mais
   recente.
2. Criar um **novo** ticket, já fechado com a nova pesagem de saída,
   marcado como repesagem e referenciando o ticket original.
3. Marcar também o ticket **original** como "repesado", referenciando o
   novo ticket — os dois lados precisam ser rastreáveis.
4. Se houver mais de um ticket `CLOSED` elegível para a mesma placa dentro
   da janela (ex.: repesagem de uma repesagem), sempre usar o **mais
   recente** — isso encadeia naturalmente sem lógica extra, desde que a
   busca ordene por `exitAt desc`.

Isso é uma exceção deliberada à regra "nunca adivinhar" existente — fica
documentada no master plan §5/§11 ao final deste trabalho (não só aqui).

## Design

- **Config**: novo `EXIT_REWEIGH_WINDOW_MS` (default `7200000` = 2h), mesmo
  padrão de `CAMERA_POST_RELEASE_DEBOUNCE_MS`/`CAMERA_DUPLICATE_PLATE_DEBOUNCE_MS`
  (`parsePositiveInt`), novo arquivo `tickets/config.ts`.
- **Schema** (`db/schema.ts`, tabela `tickets`): duas colunas novas,
  nullable, auto-referenciando `tickets.id`:
  - `reweighOfTicketId` — setada no ticket **novo**, aponta para o ticket
    original que ele está corrigindo.
  - `reweighedByTicketId` — setada no ticket **original**, aponta para o
    novo ticket que o substituiu. As duas são setadas juntas, na mesma
    transação, quando a repesagem é criada.
- **Repository** (`tickets/repository.ts`):
  - `findMostRecentClosedTicketByPlate(plate)`: `status = 'CLOSED' AND
    exitAt IS NOT NULL`, `ORDER BY exitAt DESC LIMIT 1` — a ordenação por
    `exitAt desc` já resolve o requisito "sempre o mais recente" (item 4
    acima), incluindo quando o candidato mais recente é ele mesmo uma
    repesagem.
  - `CreateTicketInput` ganha `reweighOfTicketId?: number | null`.
  - novo método `linkReweigh(originalTicketId, newTicketId)`: `UPDATE
    tickets SET reweighedByTicketId = newTicketId WHERE id =
    originalTicketId`.
- **Session service** (`tickets/session-service.ts`), dentro do ramo "sem
  ticket `OPEN`" de `handleExitReading`:
  - Só considera repesagem quando `input.weightCaptureFailed === false` —
    uma captura de saída que falhou não tem peso novo para fechar nada; cai
    no fluxo `ANOMALY` de hoje, sem mudança (ponto aberto, não bloqueante —
    ver "Fora de escopo" abaixo).
  - Busca `findMostRecentClosedTicketByPlate(plate)`; se existir e
    `weighingFinishedAt - candidate.exitAt <= reweighWindowMs`: cria o novo
    ticket reaproveitando `entryAt`/`entryWeightKg`/`entryCameraId`/
    `entryCaptureFailed` do candidato, fecha-o imediatamente com o peso
    capturado agora, chama `linkReweigh`, grava dois audit logs novos
    (`REWEIGH_CREATED` no novo, `REWEIGHED` no original) e os `raw_events`
    de câmera/báscula como os outros ramos já fazem. Retorna um novo
    `ExitResult` kind: `{ kind: 'ticket_reweighed', ticket, originalTicketId }`.
  - Caso contrário (sem candidato elegível), cai no `flagAnomaly` de hoje,
    inalterado.
  - `createSessionService` passa a receber a config (`reweighWindowMs`)
    como terceiro argumento.
- **Camera routes** (`camera/routes.ts`): tratar `ticket_reweighed` igual a
  `ticket_closed` para fins de impressão (`printService.printIfNeeded`); o
  sinal ao motorista já cai no `else` existente porque
  `weightCaptureFailed` é `false` nesse ramo — não precisa de novo `if`.
- **Admin UI**: no detalhe do ticket, mostrar link para o ticket original
  quando `reweighOfTicketId` estiver setado ("Repesagem do ticket #N") e
  link para o novo quando `reweighedByTicketId` estiver setado ("Repesado
  pelo ticket #N"); badge equivalente na listagem. Strings em pt-BR/en.

## Fora de escopo (não bloqueante, registrar como ponto aberto)

- Falha de captura de peso no que seria uma repesagem ainda cai em
  `ANOMALY` sem tratamento especial — aceitável por agora, o operador vê o
  `raw_events`/audit log como em qualquer outra anomalia.
- Nenhuma trava contra reaproveitar a entrada de um ticket `CLOSED` que
  tenha sido fechado via conjunto interno (tara) — teoricamente possível,
  mas não é o caso de uso relatado; não vale complicar a query agora.

## Implementation steps

- [x] **Step 1 — Config**: `tickets/config.ts` (`loadTicketConfig`,
      `EXIT_REWEIGH_WINDOW_MS`, default 2h), `.env.example`, testes.
      Status: done.
- [x] **Step 2 — Schema & migration**: colunas `reweighOfTicketId`/
      `reweighedByTicketId` em `db/schema.ts`; migração drizzle
      `0003_petite_longshot.sql`.
      Status: done.
- [x] **Step 3 — Repository**: `findMostRecentClosedTicketByPlate`,
      `linkReweigh`, `CreateTicketInput.reweighOfTicketId`; testes.
      Status: done.
- [x] **Step 4 — Session service**: novo `ExitResult` kind
      `ticket_reweighed`, lógica de matching/criação/fechamento/audit log,
      `createSessionService` recebe `reweighWindowMs`; `app.ts` conecta a
      config; testes cobrindo janela, fora da janela, captura falhou,
      encadeamento.
      Status: done.
- [x] **Step 5 — Camera routes**: imprimir no `ticket_reweighed`; também
      ajustado `WeighingOutcome` (`camera/weighing-events.ts` e o espelho
      `admin-ui/src/lib/useWeighingEvents.ts`) e `CLOSING_OUTCOMES` do
      painel de operação, descoberto via typecheck; testes.
      Status: done.
- [x] **Step 6 — Admin UI**: tipo `Ticket` (+fixtures/mocks), links em
      `TicketDetailPage`, badge em `TicketTable`, i18n pt-BR/en, testes.
      Status: done.
- [x] **Step 7 — Docs**: master plan §4 (colunas), §5 (nova regra) e §11
      (decisão/histórico) atualizados.
      Status: done.

Verificação final: `npm run lint`, `npm run typecheck` e `npm run build`
(raiz do monorepo) passaram limpos via container Alpine. `npm run test`
passa por arquivo/workspace isoladamente; a corrida completa do
`core-service` mostra 3 timeouts de `beforeEach` (10s) intermitentes —
confirmado como flakiness pré-existente do ambiente (container sob carga
com muitos workers paralelos abrindo SQLite), reproduzido também em `main`
sem as mudanças deste plano, não uma regressão introduzida aqui.

**Atualização (2026-11-12):** usuário autorizou executar o plano inteiro
sem pausas de validação a cada passo — passos 2–7 executados em sequência.

**Pendente**: apagar este arquivo de plano só depois que o usuário
commitar/mergear este trabalho (ele é quem controla commits/PRs neste
projeto) — não apagado ainda.
