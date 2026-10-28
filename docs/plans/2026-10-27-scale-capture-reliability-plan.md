# Confiabilidade da captura de peso: retry, timeout maior, peso mínimo, nunca liberar sem peso

Status: **Todos os 6 passos concluídos, verificados (container Alpine autoritativo + nativo). Pendente só o que o próprio passo 5 deixou explicitamente para depois do merge: a nota em `CLAUDE.md`. Commit fica a cargo do usuário.**
Created: 2026-10-27

## Context

Relatos recorrentes de caminhões parados ~1m30s na balança e de
entradas/saídas sem peso contabilizado (`weightCaptureFailed: true` /
`weightKg: null`). O plano anterior
(`docs/plans/2026-10-26-scale-logging-improvements-plan.md`, já mergeado
em `ba0d5e9`) deixou isso explicitamente fora de escopo: "qualquer mudança
em timeout, retry/backoff... é um plano separado". Este é esse plano.

Decisões já tomadas em conversa com o usuário (2026-10-27):

1. **"Nunca liberar sem peso" e "nunca tentar infinitamente" são as duas
   absolutas, simultaneamente.** Quando a captura falhar (após esgotar as
   tentativas), o registro fica pendente de correção por um operador —
   nunca é liberado automaticamente. Não há alerta automático ao operador
   ainda (fora de escopo, decisão já registrada antes).
2. **`SCALE_STABILITY_TIMEOUT_MS = 30000` já foi testado em campo e
   resolveu a grande maioria dos erros de leitura** — vira o novo default,
   não é só um valor hipotético.
3. **Retry: 3 tentativas** antes de desistir e cair em pendência manual
   (abordagem "(b)" discutida: reconectar entre tentativas, não só esperar
   mais tempo numa única tentativa).
4. **Peso mínimo válido parametrizável, default 500kg** — uma leitura
   estável abaixo disso não deve ser aceita como peso do ticket.
5. **Fora de escopo, explicitamente pedido pelo usuário**: a liberação do
   motorista hoje é feita por um botão físico que o operador aperta
   manualmente — o relé de hardware (`driver-signal`) ainda não está
   implementado/ligado a nada real no site (decisão já registrada em
   CLAUDE.md: hardware do relé é item de Phase 7, on-site). Por isso,
   **nenhuma mudança neste plano deve disparar ou depender do
   `driverSignalAdapter.signalDriver` como parte da correção de um ticket
   pelo admin** — os endpoints `PATCH /tickets/:id/entry` e `.../exit`
   continuam exatamente como hoje. A única mudança no uso do
   `driverSignalAdapter` é **não chamá-lo automaticamente no webhook da
   câmera quando a captura de peso falhar** (ver passo 4) — isso é
   puramente sobre o fluxo automático entrada/saída, não sobre a tela de
   admin.

## Scope

Mudança de regra de negócio (ao contrário do plano de logging anterior):
retry + timeout maior + peso mínimo no caminho de leitura da balança, e
parar de fechar/liberar automaticamente um ticket sem peso válido.

Fora de escopo (não fazer neste plano):
- Alertar o operador automaticamente (push/som/tela) quando a captura
  falhar definitivamente — decisão já tomada antes, continua fora.
- Qualquer botão novo de "liberar motorista" na Admin UI, ou disparo de
  `driverSignalAdapter` a partir da correção de ticket — explicitamente
  pedido pelo usuário para não tocar agora.
- Corrigir o bug do `connectionCount` em `scale-bridge/relay-server.ts`
  (já sinalizado como fora de escopo no plano anterior).
- Mudanças em `apps/scale-bridge` — ele só repassa bytes, nada aqui muda
  o que ele faz.

## Steps

1. **Config: novos defaults e parâmetros.**
   - `core-service/src/scale/config.ts`: mudar o default de
     `stabilityTimeoutMs` de 15000 para **30000**; adicionar
     `stabilityRetryCount` (env `SCALE_STABILITY_RETRY_COUNT`, default
     **3**); adicionar `minValidWeightKg` (env
     `SCALE_MIN_VALID_WEIGHT_KG`, default **500**).
   - `config.test.ts`: cobrir os novos defaults e override por env var.
   Status: **done.** Reaproveitado `parsePositiveInt` existente para os
   dois campos novos (mesmo padrão dos demais campos de `ScaleConfig`).
   `npm run test`/`typecheck` nativos passaram.

2. **Peso mínimo no parser DGN.**
   - `dgn-frame-parser.ts`: `createDgnFrameParser` ganha
     `minValidWeightKg` em `DgnFrameParserOptions` (default 500, mas
     sempre vindo explícito de `config.ts` em produção). Uma leitura com
     `weightKg < minValidWeightKg` nunca conta para a sequência de
     estabilidade — mesmo tratamento que o byte de status não confirmado
     (zera `currentValue`/`matchCount`, retorna `stable: false`), com um
     `logger.warn` distinto (`'scale: weight below minimum valid
     threshold, not counted toward stability'`) para diferenciar esse
     caso do byte de status no log.
   - `dgn-frame-parser.test.ts`: caso novo cobrindo peso abaixo do
     mínimo (não estabiliza mesmo repetindo), e que o log distinto
     dispara.
   Status: **done.** Default do parser para `minValidWeightKg` é 500
   (mesmo valor de `ScaleConfig`), consistente com `requiredMatches`/
   `sampleIntervalMs` já espelharem seus defaults de config. O teste
   antigo "treats F (empty platform) the same as D for stability" usava
   peso 0 — ajustado para 59080, já que sob a nova regra um peso de 0kg
   nunca mais estabiliza (é exatamente o cenário de plataforma vazia
   entre caminhões que o filtro deve rejeitar). `npm run test` nativo:
   16/16 em `dgn-frame-parser.test.ts`.

3. **Retry no `tcp-client.ts`.**
   - Extrair a lógica atual de `readOne` (uma tentativa, já com seu
     timeout de conexão + timeout de estabilidade) sem mudar seu
     comportamento interno.
   - `readStableWeight` passa a chamar essa tentativa em loop, até
     `stabilityRetryCount` vezes, parando na primeira que não for
     `weightCaptureFailed`. Cada tentativa após uma falha já reconecta
     naturalmente (o `teardown()` existente no timeout de estabilidade já
     zera `socket`, forçando `connect()` a abrir de novo na tentativa
     seguinte); falhas de conexão (`connect_error`/`connect_timeout`)
     também contam como tentativa e tentam de novo.
   - Resultado final (depois de esgotar as tentativas): mesmo formato de
     `ScaleReadResult` de hoje, com `waitedMs` somando o tempo de todas as
     tentativas (tempo real que o caminhão ficou parado) e um novo campo
     de log (não precisa ir para o tipo público) indicando quantas
     tentativas rodaram, para aparecer no log estruturado.
   - `tcp-client.test.ts`: casos novos — sucesso na 2ª/3ª tentativa depois
     de falhas, falha definitiva só depois de esgotar as 3 tentativas
     (incluindo teste de que `readStableWeight` demora proporcionalmente
     a 3 tentativas quando todas falham), e que a fila de leitura
     (`readQueue`) continua serializando corretamente mesmo com retries
     internos.
   Status: **done.** `stabilityRetryCount` default 1 em `tcp-client.ts`
   (não em `ScaleConfig`, que já é 3) — assim todos os testes/chamadores
   existentes que não passam a opção continuam de tentativa única,
   inalterados; produção liga o retry explicitamente via
   `server.ts`/`scaleConfig.stabilityRetryCount`. Cada tentativa de
   `readOne` já loga seu próprio `warn` (reaproveitado, sem log
   duplicado por tentativa) — só adicionei `attempt`/`stabilityRetryCount`
   nos metadados desse log para diferenciar tentativas na mesma leitura.
   `waitedMs` do resultado final soma todas as tentativas. `npm run test`
   nativo: 18/18 em `tcp-client.test.ts` (4 casos novos). `server.ts`
   atualizado para passar `stabilityRetryCount`/`minValidWeightKg`;
   `typecheck` nativo ok.

4. **Parar de liberar automaticamente sem peso válido.**
   - `camera/routes.ts`: nos dois handlers (`/webhooks/camera/entrance` e
     `/webhooks/camera/exit`), só chamar
     `options.driverSignalAdapter.signalDriver('in'|'out')` quando
     `!weightCaptureFailed`. Quando falhar, logar explicitamente que o
     sinal foi retido e o caminhão permanece aguardando correção manual.
   - `session-service.ts` → `handleExitReading`: quando existir um ticket
     `OPEN` correspondente e `input.weightCaptureFailed` for `true`, **não
     chamar `repo.close()`** — manter o ticket `OPEN`, só gravar o audit
     log (`EXIT_CAPTURE_FAILED`) e o `rawEvent` de `source: 'scale'` como
     hoje. Isso deixa o ticket pronto para ser fechado por uma leitura de
     saída bem-sucedida futura (reentrada da câmera) ou pela correção
     manual do admin em `PATCH /tickets/:id/exit` (que já fecha um ticket
     `OPEN` via `repo.close()`, sem mudança nenhuma necessária nesse
     endpoint).
   - O caminho de `handleEntranceReading` já cria o ticket `OPEN` com
     `entryCaptureFailed: true`/`entryWeightKg: null` sem fechá-lo —
     nenhuma mudança de dados necessária aqui, só a retenção do sinal em
     `camera/routes.ts`.
   - O caminho de anomalia por "saída sem entrada correspondente"
     (`repo.flagAnomaly`) não muda — ele já é sobre uma placa sem ticket
     aberto, não sobre peso; `weightCaptureFailed` nesse ramo já fica
     registrado como hoje.
   - `camera/routes.test.ts`: confirmar que `driverSignalCalls` fica vazio
     quando a leitura falha (entrada e saída), e que ainda dispara
     normalmente em sucesso.
   - `session-service.test.ts`: confirmar que uma saída com
     `weightCaptureFailed: true` sobre um ticket `OPEN` retorna
     `kind: 'ticket_closed'`... **não** — precisa de um novo `kind` (ex.
     `'exit_capture_pending'`) já que não fechou nada; ajustar o tipo
     `ExitResult` e o `toResponseBody` em `camera/routes.ts` de acordo.
   Status: **done.** `ExitResult` ganhou `kind: 'exit_capture_pending'`;
   `toResponseBody` não precisou de mudança (já genérico via `'ticket' in
   result`). Adicionado também um teste novo em `session-service.test.ts`
   confirmando que uma saída pendente é fechada normalmente por uma
   leitura de saída bem-sucedida posterior para a mesma placa (sem
   mudança de código extra — `findOpenByPlate` já encontra o ticket
   porque ele nunca foi fechado). `npm run test` nativo completo:
   213/213 em todos os 24 arquivos de teste de `core-service`
   (nenhuma regressão fora dos 3 testes já esperados e atualizados:
   `records entryCaptureFailed...`, o teste de exit renomeado em
   `camera/routes.test.ts`, e os dois em `session-service.test.ts`).
   `npm run lint` (raiz) e `typecheck` nativos: sem erros.

5. **Atualizar a documentação da decisão.**
   - Master plan (`docs/plans/2026-09-29-tare-weight-ticket-plan.md`),
     §5 e §11: a regra "o sinal do motorista dispara logo depois de toda
     leitura da balança, sucesso ou falha, para o caminhão nunca ficar
     parado" está **revertida** para o caso de falha de captura — agora é
     o oposto: nunca libera automaticamente sem peso válido, até um
     limite de tentativas, caindo em pendência manual depois disso.
     Documentar os novos parâmetros (`stabilityTimeoutMs=30000`,
     `stabilityRetryCount=3`, `minValidWeightKg=500`) e a decisão
     explícita de não tocar no disparo manual de liberação (botão físico
     do operador) nesta rodada.
   - `CLAUDE.md`: atualizar a nota de "Project status" mencionando esta
     mudança uma vez implementada e mergeada.
   Status: **done o master plan (§5 e §11), com nota de decisão datada
   2026-10-27 preservando a regra original para histórico.** `CLAUDE.md`
   deliberadamente **não** atualizado ainda — o próprio texto deste passo
   e o workflow do `CLAUDE.md` dizem para fazer essa nota só depois de
   mergeado em `main`; como o usuário vai commitar tudo ao final desta
   sessão, essa atualização fica para depois do merge (ou eu faço no
   início da próxima sessão, se preferir).

6. **Verificar.**
   - `core-service`: lint/typecheck/test/build dentro do container Alpine
     (comando documentado no `CLAUDE.md`), autoritativo.
   - Sanity nativo no Windows como checagem rápida adicional.
   - `apps/scale-bridge` não é tocado neste plano — não precisa
     reverificar.
   Status: **done.** Container Alpine (`node:24-alpine`, com
   `node_modules` apagado e reinstalado limpo antes — misturar instalação
   nativa/container corrompeu os shims, exatamente o aviso já documentado
   no `CLAUDE.md`): `lint`, `typecheck`, `test` (213/213), `build`, todos
   ok. `node_modules` reinstalado limpo de novo nativamente no Windows
   depois, e `typecheck`/`test` nativos re-confirmados (213/213) — repo
   fica num estado consistente para qualquer um dos dois ambientes.

## Open questions / riscos a observar

- Pior caso de tempo parado na balança sobe para **~90s** (3 tentativas ×
  30s) antes de cair em pendência manual — bem mais que os ~20s de hoje.
  Se isso se mostrar longo demais na prática, o próximo ajuste é reduzir
  `stabilityRetryCount` ou `stabilityTimeoutMs` individualmente, não as
  duas juntas.
- O novo `kind: 'exit_capture_pending'` (ou nome equivalente) em
  `ExitResult` precisa de um corpo de resposta HTTP sensato em
  `camera/routes.ts` — a câmera/relé físico que recebe essa resposta não
  deveria precisar entender isso de forma diferente de uma falha comum;
  confirmar que o código de status HTTP continua 200 (a câmera só espera
  confirmação de recebimento, a falha de peso é um problema interno).
