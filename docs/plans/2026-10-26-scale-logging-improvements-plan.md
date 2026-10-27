# Melhorar o logging da leitura da balança (sucesso e falha)

Status: **All 5 steps done. Verified natively (core-service, scale-bridge) and inside the Alpine container (core-service, authoritative). Not yet committed — pending user review.**
Created: 2026-10-26

## Context

Reclamações recorrentes: o peso sai como "—" (`formatWeight` em
`apps/admin-ui/src/lib/datetime.ts:19`, exibido em `TicketTable.tsx` e
`TicketDetailPage.tsx`) na entrada, na saída, ou nas duas, de um mesmo
ticket. Isso vem direto de `weightCaptureFailed: true` /
`weightKg: null` gravado no ticket pelo `session-service.ts`.

Investigação do caminho completo (balança física → `apps/scale-bridge` →
TCP → `apps/core-service`) mostrou que **não há como descobrir o motivo
hoje**, só o fato de que falhou:

- `core-service/src/scale/tcp-client.ts`: **zero logging**. Erro de
  conexão, timeout de conexão, erro de socket em sessão já conectada, e
  timeout de estabilidade (`stabilityTimeoutMs`) — todos colapsam para o
  mesmo `{ weightKg: null, weightCaptureFailed: true }`, sem distinção.
- `core-service/src/scale/dgn-frame-parser.ts`: bytes/frames não
  reconhecidos são descartados em silêncio (linha ~94). É justamente o
  ponto onde a semântica dos bytes de estado — documentada como suposição
  **não confirmada pelo fabricante** (master plan §7/§11) — se mostraria
  errada na prática, e não sobra nenhum rastro.
- `apps/scale-bridge/src/serial-transport.ts`: tem alguns `console.error`
  (falha ao abrir a porta COM, falha ao setar DTR/RTS, evento `error` da
  porta), mas nada no caminho de sucesso nem no fechamento, sem timestamp
  nem estrutura.
- `apps/scale-bridge/src/relay-server.ts`: **zero logging** de conexão/
  desconexão do `core-service` ou de erro ao repassar bytes — tudo
  silenciosamente descartado em `clients.delete(socket)`. (Reparo à parte,
  não coberto por este plano: `connectionCount` é um total acumulado que
  nunca decresce ao desconectar, então `GET /health` nunca reflete se o
  `core-service` está conectado *agora*.)
- `rawEvents.source` já suporta `'scale'` no schema/tipo
  (`db/schema.ts`, usado só em teste), mas nenhum código de produção grava
  um — diferente dos eventos de câmera, que já ficam gravados e
  pesquisáveis via `/api/admin/unresolved-events`.

Resultado: hoje é impossível, só com logs ou dados já salvos, dizer se um
"—" veio de problema na porta COM, de uma rede instável entre
`scale-bridge` e `core-service`, do timeout de estabilidade ser curto
demais, ou de um frame que o parser não reconhece.

## Scope

Logging estruturado e com nível, cobrindo o caminho inteiro da leitura
(serial → relay → cliente TCP → parser de frame), substituindo o booleano
único por um motivo de falha específico, persistindo toda leitura (sucesso
e falha) como linha pesquisável em `rawEvents`, e correlacionando cada
leitura com o webhook que a disparou. Só observabilidade — nenhuma mudança
de regra de negócio, timeout ou retry.

Fora de escopo (ver seção final): o bug do `connectionCount`, mudanças na
Admin UI além do que a tela de eventos não resolvidos já renderiza,
qualquer ajuste de timeout/retry.

## Steps

1. **Motivo de falha estruturado em `ScaleReadResult`.**
   - `scale/types.ts`: `ScaleReadResult` ganha `failureReason?:
     'connect_error' | 'connect_timeout' | 'socket_error' |
     'stability_timeout'` e `waitedMs: number` (presente em sucesso e
     falha).
   - `tcp-client.ts`: cada caminho que hoje retorna o mesmo booleano passa
     a propagar o motivo real — `onConnectFailure` já distingue erro vs.
     timeout de conexão; o timer em `readOne()` é `stability_timeout`;
     `socket.on('error'/'close')` após conexão já estabelecida é
     `socket_error`.
   - Atualizar `mock-scale-server.ts` e `tcp-client.test.ts`: um teste por
     motivo de falha, verificando o `failureReason` certo.
   Status: done. `failureReason`/`waitedMs` ficaram opcionais no tipo
   (em vez de obrigatórios) para não quebrar os vários stubs de
   `ScaleClient` já existentes em outros testes
   (`app.test.ts`/`hardware-status.test.ts`/`admin/routes.test.ts`/
   `printing/routes.test.ts`/`camera/routes.test.ts`) — a implementação
   real em `tcp-client.ts` sempre os preenche. `mock-scale-server.ts` não
   precisou mudar (a diferenciação de motivo acontece inteira dentro do
   `tcp-client.ts`, via uma classe `ScaleConnectFailure` interna). Testes
   de `tcp-client.test.ts` migrados de `toEqual` para `toMatchObject`
   (o resultado real agora tem `waitedMs`, não-determinístico).

2. **Logger real no cliente da balança e no `scale-bridge`, logando toda leitura.**
   - `server.ts`: criar uma instância `pino` única no bootstrap e passá-la
     ao Fastify via `loggerInstance` (suportado no Fastify 5.12.5 já
     instalado, ver `node_modules/fastify/docs/Reference/Logging.md`) em
     vez de `logger: true`; passar um logger filho
     (`logger.child({ component: 'scale-client' })`) para
     `createTcpScaleClient`.
   - `tcp-client.ts`: `info` em toda leitura bem-sucedida (`weightKg`,
     `waitedMs`); `warn` em toda falha (`failureReason`, `waitedMs`, host,
     porta); `debug` nos eventos de ciclo de vida da conexão
     (connect/close/teardown). Nenhum branch silencioso deve sobrar.
   - `camera/routes.ts`: passar `request.log` (ou um filho dele) para
     `readStableWeight()`, de forma que a linha de log da balança carregue
     o mesmo `reqId` que o Fastify já atribui ao webhook que a disparou —
     permite correlacionar o evento de câmera com o resultado da balança
     buscando um único `reqId`.
   - `apps/scale-bridge`: trocar os `console.log`/`console.error` em
     `server.ts` e `serial-transport.ts` pelo mesmo padrão de logger
     (`loggerInstance` compartilhado a partir do Fastify que `app.ts` já
     cria), para que o `service.log` do NSSM vire JSON estruturado com
     timestamp em vez de string solta.
   - `relay-server.ts`: logar conexão/desconexão TCP do lado do
     `core-service` e qualquer erro de socket ao repassar bytes (hoje
     descartado em silêncio) — este arquivo não tem Fastify próprio, então
     recebe o logger compartilhado por parâmetro vindo de `server.ts`.
   Status: done. Logger mínimo próprio criado em
   `apps/scale-bridge/src/logger.ts` (`BridgeLogger`/`noopLogger`), já que
   `serial-transport.ts`/`relay-server.ts` não importam Fastify/pino
   diretamente. `pino` adicionado como dependência direta em
   `core-service` e `scale-bridge` (antes só vinha transitivo via
   Fastify). Teste novo em `relay-server.test.ts` cobrindo log de
   conexão/desconexão.

3. **Logar anomalias do parser DGN.**
   - `dgn-frame-parser.ts`: aceitar um logger opcional; `warn` com os bytes
     brutos (hex) sempre que dados recebidos não casarem com nenhum
     padrão de frame/byte de estado reconhecido — é exatamente o ponto
     onde a suposição não confirmada pelo fabricante (master plan §7/§11)
     apareceria na prática. Sem mudança de comportamento do parsing, só
     observabilidade.
   - `dgn-frame-parser.test.ts`: confirmar que o `warn` dispara com bytes
     malformados/inesperados propositais, e que a saída do parsing não
     muda.
   Status: done. Três `warn` distintos: frame não reconhecido (padrão não
   casa), byte de estado não confirmado (`@`, `H`, `B`, ...), e overflow
   do buffer (`MAX_BUFFER_LENGTH`). Token vazio entre dois CRs adjacentes
   explicitamente não loga (é um delimitador perdido benigno, não uma
   anomalia).

4. **Persistir toda leitura da balança como `rawEvents` pesquisável.**
   - O cliente da balança não acessa banco (mantém `tcp-client.ts` livre de
     dependência de repositório) — em vez disso, o `ScaleReadResult` (já
     com `failureReason`/`waitedMs` do passo 1) continua fluindo até
     `session-service.ts`, que já tem o repositório e o id do ticket.
   - `session-service.ts`: ao lado de cada `repo.recordRawEvent
     ('camera_entrance' | 'camera_exit', ...)` já existente (chamado uma
     vez por entrada/saída, dentro da mesma transação SQLite do handler),
     adicionar um `repo.recordRawEvent('scale', { weightKg,
     weightCaptureFailed, failureReason, waitedMs, direction },
     ticket.id)` paralelo, nos quatro pontos já existentes
     (entrada/saída × capturado/falhou).
   - Isso reaproveita a busca de eventos não resolvidos/histórico que a
     Admin UI já tem (já filtra por `source`, conforme teste existente em
     `repository.test.ts` com `{ source: 'scale' }`) — zero código novo de
     frontend. Uma falha de balança passa a ser tão pesquisável quanto uma
     placa não lida hoje já é.
   - `repository.test.ts`/`session-service.test.ts`: estender os testes
     existentes para verificar que um `rawEvent` de `source: 'scale'` é
     gravado tanto em leitura capturada quanto em falha, vinculado ao
     ticket.
   Status: done. Correção em relação ao plano original: o código real tem
   **três** pontos de `recordRawEvent('camera_...', ...)` dentro de
   transação, não quatro — `handleEntranceReading` tem um único ponto
   cobrindo tanto captura OK quanto falha (o campo `weightCaptureFailed`
   já varia dentro do mesmo registro), e `handleExitReading` tem dois
   (ticket fechado e anomalia). O `scale` raw event paralelo foi
   adicionado nesses três pontos reais.

5. **Verificar de ponta a ponta, nos dois ambientes conforme o CLAUDE.md.**
   - `core-service`: lint/typecheck/test/build dentro do container Alpine
     (comando Docker documentado no CLAUDE.md), já que é o artefato que
     roda em produção.
   - `scale-bridge`: typecheck/test/build nativo no Windows (CLAUDE.md),
     já que é serviço NSSM, nunca containerizado.
   - Manual: rodar uma leitura real (ou simulada via `mock-scale-server`)
     pelo caminho completo e confirmar que `docker compose logs
     core-service` mostra uma linha correlacionada por webhook+resultado
     da balança, `apps\scale-bridge\service.log` mostra entradas
     estruturadas do mesmo evento, e a linha de `rawEvents` resultante
     (via `/api/admin/unresolved-events` ou consulta direta) mostra o
     motivo da falha.
   Status: done para a parte automatizada — `lint`/`typecheck`/`test`/
   `build` passaram tanto nativo no Windows quanto dentro do container
   Alpine para `core-service` (205/205 testes), e nativo no Windows para
   `scale-bridge` (11/11 testes). A parte manual (rodar uma leitura real
   pelo caminho completo `core-service` → `scale-bridge` → balança física
   ou mock, e olhar os logs/rawEvents resultantes) **não foi feita nesta
   sessão** — não há ambiente com hardware/serviços rodando aqui. Fica
   pendente para quando o usuário reiniciar os serviços (NSSM) com o
   código novo, igual ao padrão já usado no plano do
   `network-printer-transport` (confirmação feita no PC de produção).

## Out of scope for this plan

- Corrigir o `connectionCount` de `relay-server.ts` (contador que nunca
  decresce ao desconectar, encontrado durante a leitura deste arquivo) —
  sinalizando separadamente; abro um plano próprio se o usuário quiser.
- Qualquer mudança em timeout, retry/backoff, ou na lógica de espera de
  estabilidade — este plano é só observabilidade; se os passos 1-4
  revelarem a causa real dos "—" (ex.: `stability_timeout` dominando), a
  correção *disso* é um plano separado.
- Mudanças na Admin UI além do que a tela de eventos por `source` já
  renderiza (nenhuma tela/componente novo).
