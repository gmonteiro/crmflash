# Tasks: Polish / UX

## Modulo: Dashboard, Dark Mode, Responsividade

### Task 7.1: Dashboard Stats
- **Status:** DONE
- **Arquivo:** `src/app/(dashboard)/dashboard/page.tsx`
- **Descricao:** Cards mostrando: total people, total companies, total imports. Pipeline overview com contagem por coluna kanban
- **Criterio:** Numeros corretos, layout limpo

### Task 7.2: Dark Mode
- **Status:** DONE
- **Descricao:** next-themes com ThemeProvider no root layout. Seletor em Settings. Todas as cores via CSS variables do Tailwind
- **Criterio:** Toggle funciona, nenhum flash

### Task 7.3: Responsividade
- **Status:** DONE
- **Descricao:** Sidebar colapsa em mobile (Sheet). Tabelas com overflow-x. Kanban com scroll horizontal. Grid responsivo nos detail cards
- **Criterio:** Usavel em tela 375px

### Task 7.4: Skeletons
- **Status:** DONE
- **Descricao:** Skeleton components do shadcn em todas as paginas que fazem fetch
- **Criterio:** Nao mostra tela em branco durante loading

### Task 7.5: Toasts
- **Status:** DONE
- **Descricao:** sonner integrado. Toasts em: CRUD operations, import, enrichment, column actions, errors
- **Criterio:** Feedback visual para toda acao
