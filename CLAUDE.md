# CLAUDE.md

Este arquivo fornece orientações ao Claude Code (claude.ai/code) ao trabalhar com o código neste repositório.

## Comandos

```bash
# Desenvolvimento
npm run dev          # Start with hot reload (tsx --watch)

# Banco de dados
docker-compose up -d                      # Start PostgreSQL (port 55432)
npx prisma migrate dev --name <name>      # Create and apply a migration
npx prisma generate                       # Regenerate Prisma client after schema changes
npx prisma studio                         # Open Prisma Studio GUI

# Qualidade de código
npx eslint .         # Lint
npx prettier --write .  # Format
```

Scripts de build e testes ainda não estão configurados.

## Arquitetura

API REST em **Fastify v5 + TypeScript** para um aplicativo de acompanhamento de treinos.

### Stack
- **HTTP**: Fastify 5 com `fastify-type-provider-zod` (schemas Zod inferidos como tipos TypeScript e usados simultaneamente na validação do Fastify)
- **Banco de dados**: PostgreSQL 16 (Docker) via **Prisma 7** com `@prisma/adapter-pg` (connection pooling)
- **Auth**: **Better Auth** — autenticação baseada em sessão com adaptador Prisma; rotas montadas em `/api/auth/*` como catch-all do Fastify
- **Docs**: Swagger/OpenAPI exposto em `/swagger.json` e Scalar UI em `/docs`

### Organização do Código

```
src/
├── index.ts          # App Fastify: registra plugins, monta rotas, inicia servidor
├── lib/
│   ├── auth.ts       # Instância do Better Auth (email/senha + plugin OpenAPI)
│   └── db.ts         # Singleton do Prisma client usando @prisma/adapter-pg
├── routes/           # Handlers de rota — validam input, verificam auth, chamam usecases
├── schemas/          # Schemas Zod compartilhados entre rotas e o type provider do Fastify
├── usecases/         # Classes de lógica de negócio (uma por operação)
└── errors/           # Classes de erro customizadas (ex: NotFoundError)
```

### Padrões

**Route → Usecase**: Rotas lidam com questões HTTP (verificação de auth, validação de schema, status codes). Usecases contêm toda a lógica de negócio e são chamados com dados já validados.

**Autenticação**: Cada rota protegida chama manualmente `auth.api.getSession({ headers })` e retorna 401 se não houver sessão. Ainda não existe middleware/hook de auth centralizado.

**Prisma client** (`src/lib/db.ts`): Usa `@prisma/adapter-pg` em vez do driver padrão. O client gerado fica em `src/generated/prisma/` (excluído do git; execute `npx prisma generate` após clonar o repositório).

**Zod + Fastify**: `fastify-type-provider-zod` é usado com `withTypeProvider<ZodTypeProvider>()` para que os schemas Zod passados às opções de rota do Fastify forneçam tanto validação em runtime quanto tipos TypeScript sem duplicação.

### Schema do Banco de Dados (modelos principais)

| Modelo | Observações |
|---|---|
| `User` | Gerenciado pelo Better Auth; possui relação `workoutPlans` |
| `WorkoutPlan` | Pertence a User (cascade delete); possui flag `isActive` — apenas um plano ativo por usuário por vez |
| `WorkoutDay` | Pertence a WorkoutPlan; possui enum `WeekDay` e flag `isRest` |
| `WorkoutExecise` | Atenção: typo intencional no nome do modelo; pertence a WorkoutDay (cascade delete) |
| `WorkoutSession` | Registra quando um WorkoutDay foi realizado |
| `Session`, `Account`, `Verification` | Tabelas internas do Better Auth |

### Variáveis de Ambiente

| Variável | Descrição |
|---|---|
| `PORT` | Porta do servidor (padrão: 3333) |
| `DATABASE_URL` | String de conexão do PostgreSQL |
| `BETTER_AUTH_SECRET` | Secret para assinar tokens de auth |
| `BETTER_AUTH_URL` | URL base pública (ex: http://localhost:3333) |
