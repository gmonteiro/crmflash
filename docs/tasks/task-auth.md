# Tasks: Auth

## Modulo: Autenticacao e Autorizacao

### Task 1.1: Setup Supabase Client
- **Status:** DONE
- **Arquivos:** `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`
- **Descricao:** Criar clientes Supabase para browser (singleton via `createBrowserClient`) e server (cookie-based via `createServerClient`)
- **Criterio:** Ambos os clients instanciam corretamente com env vars

### Task 1.2: Middleware de Auth
- **Status:** DONE
- **Arquivo:** `src/middleware.ts`
- **Descricao:** Interceptar todas as rotas. Rotas publicas: `/login`, `/signup`, `/auth/callback`. Demais exigem sessao valida, senao redireciona para `/login`
- **Criterio:** Usuario nao autenticado e redirecionado; autenticado passa

### Task 1.3: Pagina de Login
- **Status:** DONE
- **Arquivo:** `src/app/login/page.tsx`
- **Descricao:** Formulario email+password + botao Google OAuth. Wrapped em `<Suspense>` para `useSearchParams()`
- **Criterio:** Login funciona com email e com Google

### Task 1.4: Pagina de Signup
- **Status:** DONE
- **Arquivo:** `src/app/signup/page.tsx`
- **Descricao:** Formulario de registro com email + password
- **Criterio:** Cria usuario no Supabase Auth

### Task 1.5: OAuth Callback
- **Status:** DONE
- **Arquivo:** `src/app/auth/callback/route.ts`
- **Descricao:** Troca code por sessao. Na primeira vez, chama `create_default_kanban_columns` para criar colunas padrao
- **Criterio:** Sessao criada + colunas kanban existem apos primeiro login

### Task 1.6: Layout Dashboard com Sidebar
- **Status:** DONE
- **Arquivo:** `src/app/(dashboard)/layout.tsx`
- **Descricao:** Sidebar com navegacao (Dashboard, People, Companies, Import, Kanban, Settings) + botao logout
- **Criterio:** Navegacao funcional, logout funciona

### Task 1.7: Rodar SQL Migration
- **Status:** DONE
- **Arquivo:** `supabase/migrations/001_initial_schema.sql`
- **Descricao:** Executar no Supabase via SQL Editor ou service_role key. Cria todas as tabelas, RLS, triggers, indexes e funcao de colunas default
- **Criterio:** Todas as tabelas existem no Supabase com RLS ativo
