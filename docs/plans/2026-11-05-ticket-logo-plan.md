# Plano: logo da empresa contratante no ticket impresso

**Status:** concluído (passos 1 e 2), pendente apenas de commit/PR pelo
usuário — ver `CLAUDE.md`. Decisão de escopo (mudou o master plan §2, que
antes dizia "nothing else" além dos campos textuais): adicionar a logo da
empresa contratante (FIDA) ao topo do ticket impresso. Fonte da logo:
imagem fornecida pelo usuário em `C:\Users\fabri\Downloads\WhatsApp Image
2026-11-04 at 15.23.19.jpeg` (fundo branco, oval verde/dourado, texto
"FIDA"). Usuário autorizou implementar o plano inteiro sem pausas de
revisão entre os passos.

Este arquivo pode ser apagado assim que o trabalho for commitado/mergeado,
por convenção do `CLAUDE.md` (documento de trabalho, não documentação
permanente) — as decisões relevantes já foram incorporadas ao master plan
§2/§11.

## Abordagem

Impressoras ESC/POS imprimem imagens via o comando raster `GS v 0`
(bitmap monocromático 1-bit, largura em bytes múltiplos de 8). Converter a
logo colorida para esse formato em tempo de execução no `print-bridge`
exigiria uma lib de imagem rodando num processo nativo Windows sempre
ativo — preferível manter esse processo leve (mesmo espírito do
`CLAUDE.md`: preferir dependências leves/puro-JS, e o bitmap da logo não
muda a cada ticket). Em vez disso: um script **one-off** de geração
(rodado manualmente quando a logo mudar) converte a imagem fonte para os
bytes já empacotados do comando `GS v 0`, e o resultado fica **versionado**
como um módulo TS gerado. `escpos.ts` só concatena esse bitmap pronto —
zero processamento de imagem em runtime.

**Risco/suposição não confirmada em campo:** a largura útil em pontos da
POS80 instalada não está confirmada com o vendor (mesma situação já
documentada para o protocolo da balança e do payload da câmera antes de
confirmação). Vou assumir **384 pontos** (48 bytes), um valor conservador
que cabe com folga tanto em impressoras de 58mm quanto 80mm — documentar
isso como item do checklist de validação em campo, igual ao que já existe
para a balança.

## Passos

1. **[Concluído]** Copiar a imagem fonte para `apps/print-bridge/assets/`,
   escrever `apps/print-bridge/scripts/generate-logo-bitmap.mjs` (usa
   `jimp`, devDependency só do workspace `print-bridge`) que:
   - carrega a imagem fonte;
   - redimensiona mantendo proporção para a largura alvo (384px);
   - converte para preto/branco (threshold de luminância, sem dithering —
     a logo é de alto contraste, não uma foto);
   - empacota em bytes do comando `GS v 0` (xL/xH, yL/yH, dados);
   - escreve `apps/print-bridge/src/logo-bitmap.generated.ts` exportando o
     `Buffer` completo do comando pronto para concatenar.
   Alterar `buildTicketEscPos()` para imprimir o bitmap logo após
   `initialize()` (antes do título), mantendo o layout textual existente
   inalterado. Se o módulo gerado não existir (ainda não rodou o script),
   `escpos.ts` **não** deve quebrar o build — importação direta de um
   arquivo gerado e versionado é aceitável aqui porque ele é commitado,
   então não há esse caso em `main`, mas vale um fallback defensivo.
   Regenerar o mockup visual (ticket.png/ticket.pdf no scratchpad da sessão
   anterior) para conferência visual antes de prosseguir.

2. **[Concluído]** Testes (`escpos.test.ts`: novo teste confirma que os
   bytes exatos do bitmap gerado aparecem no buffer logo após o comando de
   inicialização e antes do título; os 14 testes existentes continuam
   passando — 15 no total) e documentação atualizada: master plan §2
   (substituído o "nothing else", registrando a decisão com data) e §11
   (nova seção "Company logo added to the printed ticket (2026-11-05)"),
   e `docs/runbooks/per-pc-deployment.md` com item de checklist sobre a
   largura em pontos não confirmada em campo.

`npm run test`/`typecheck` do workspace `@tare/print-bridge` verificados
verdes após cada mudança.
