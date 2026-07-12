# template_fullstack-app

A template with the symbiosika-framework

Clone the repository and run the following commands:
```bash
git clone https://github.com/symbiosika/template-fullstack-app.git --recurse-submodules
```

## Init
Run the following command to initialize the project:
```bash
cd backend
bun run init
bun run sync-skills
```

## Quick Reference (Backend)

- `bun run dev` - Start dev server
- `bun run init` - Generate secrets into .env
- `bun run docker:up` / `docker:down` - Database
- `bun run migrate` - Run all migrations
- `bun test src/path/to/file.test.ts` - Run tests
