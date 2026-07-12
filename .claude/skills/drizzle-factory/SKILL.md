---
name: drizzle-factory
description: >
  Use when creating test or seed data with Drizzle ORM. Use @praha/drizzle-factory to define factories,
  create single/multiple records, traits, seeds, compose factories, and reset sequences. Use when the user
  asks for database record factories, test data, or fixtures for Drizzle.
---

# Drizzle Factory Skill

Use [@praha/drizzle-factory](https://github.com/praha-inc/drizzle-factory) to generate and insert database records for tests or development. The library provides `defineFactory`, `composeFactory`, traits, seeds, and sequence reset.

## When to use this skill

- Writing backend tests that need database records (users, posts, etc.)
- Seeding development or test databases with consistent data
- Creating related records (e.g. post with user) without manual IDs
- Defining reusable “traits” (e.g. admin user) or “seeds” (e.g. “john” user and his posts)

## Installation

```bash
npm install @praha/drizzle-factory
```

Or with Bun:

```bash
bun add @praha/drizzle-factory
```

## Defining a Factory

Use `defineFactory` with a schema, table name, and a resolver that returns default values. The resolver receives `{ sequence, use }`; `sequence` increments for each new record.

```ts
import { defineFactory } from '@praha/drizzle-factory';
import { pgTable, text, integer } from 'drizzle-orm/pg-core';

const schema = {
  users: pgTable('users', {
    id: integer().notNull(),
    name: text().notNull(),
  }),
};

const usersFactory = defineFactory({
  schema,
  table: 'users',
  resolver: ({ sequence }) => ({
    id: sequence,
    name: `name-${sequence}`,
  }),
});
```

For MySQL, use the appropriate schema helpers (e.g. from `drizzle-orm/mysql-core`).

## Creating Records

Call the factory with your database instance, then use `.create()`.

### Single record

```ts
const user = await usersFactory(database).create();
console.log(user);
// { id: 1, name: 'name-1' }
```

### Multiple records

```ts
const users = await usersFactory(database).create(3);
console.log(users);
// [
//   { id: 1, name: 'name-1' },
//   { id: 2, name: 'name-2' },
//   { id: 3, name: 'name-3' },
// ]
```

### Override specific values

```ts
const user = await usersFactory(database).create({ name: 'John Doe' });
// { id: 1, name: 'John Doe' }

const users = await usersFactory(database).create([
  { name: 'John Doe' },
  { name: 'Jane Doe' },
]);
// [
//   { id: 1, name: 'John Doe' },
//   { id: 2, name: 'Jane Doe' },
// ]
```

## Using Other Factories in a Resolver (`use`)

Use `use` inside a resolver to create related records. Wrap the `use(...).create()` in a function so it only runs when that field is not overridden.

```ts
const postsFactory = defineFactory({
  schema,
  table: 'posts',
  resolver: ({ sequence, use }) => ({
    id: sequence,
    userId: () => use(usersFactory).create().then((user) => user.id),
    title: `title-${sequence}`,
  }),
});
```

Then:

```ts
const post = await postsFactory(database).create();
// { id: 1, userId: 1, title: 'title-1' }  // user created automatically
```

## Traits

Traits define named variants of a factory (e.g. admin user).

```ts
const usersFactory = defineFactory({
  schema,
  table: 'users',
  resolver: ({ sequence }) => ({
    id: sequence,
    name: `name-${sequence}`,
  }),
  traits: {
    admin: ({ sequence }) => ({
      id: sequence,
      name: `admin-${sequence}`,
    }),
  },
});
```

Usage:

```ts
const adminUser = await usersFactory(database).traits.admin.create();
// { id: 1, name: 'admin-1' }
```

## Seeds

Seeds are named presets that return one object or an array of objects. Use them for fixed test/dev data (e.g. “john” and “john’s posts”).

```ts
const usersFactory = defineFactory({
  schema,
  table: 'users',
  resolver: ({ sequence }) => ({
    id: sequence,
    name: `name-${sequence}`,
  }),
  seeds: {
    john: () => ({
      name: 'John Doe',
    }),
  },
});

const postsFactory = defineFactory({
  schema,
  table: 'posts',
  resolver: ({ sequence, use }) => ({
    id: sequence,
    userId: () => use(usersFactory).create().then((user) => user.id),
    title: `title-${sequence}`,
  }),
  seeds: {
    john: async ({ use }) => {
      const john = await use(usersFactory).seeds.john.create();
      return [
        { userId: john.id, title: "John's First Post" },
        { userId: john.id, title: "John's Second Post" },
      ];
    },
  },
});
```

Usage:

```ts
const john = await usersFactory(database).seeds.john.create();
// { id: 1, name: 'John Doe' }

const johnPosts = await postsFactory(database).seeds.john.create();
// [
//   { id: 1, userId: 1, title: "John's First Post" },
//   { id: 2, userId: 1, title: "John's Second Post" },
// ]
```

Seeds can return a single object or an array. Use `use` inside seeds to reference other factories or seeds.

## Composing Factories

Group multiple factories with `composeFactory` for a single entry point.

```ts
import { composeFactory } from '@praha/drizzle-factory';

const factory = composeFactory({
  users: usersFactory,
  posts: postsFactory,
});

const user = await factory(database).users.create();
// { id: 1, name: 'name-1' }

const post = await factory(database).posts.create({ userId: user.id });
// { id: 1, userId: 1, title: 'title-1' }
```

## Resetting Sequences

Each factory has an internal `sequence` that increments. Reset it (e.g. between test cases) with `resetSequence()`.

### Single factory

```ts
const users = await usersFactory(database).create(2);
// [{ id: 1, name: 'name-1' }, { id: 2, name: 'name-2' }]

usersFactory.resetSequence();
const user = await usersFactory(database).create();
// { id: 1, name: 'name-1' }
```

### Composed factory

Calling `resetSequence()` on a composed factory resets sequences for all included factories.

```ts
const factory = composeFactory({
  users: usersFactory,
  posts: postsFactory,
});

const users = await factory(database).users.create(2);
const posts = await factory(database).posts.create([
  { userId: users[0].id },
  { userId: users[1].id },
]);

factory.resetSequence();
const user = await factory(database).users.create();
const post = await factory(database).posts.create({ userId: user.id });
// user: { id: 1, name: 'name-1' }
// post: { id: 1, userId: 1, title: 'title-1' }
```

## Integration with This Project

- Use the same Drizzle schema and DB instance as in the app (e.g. from `@framework/lib/db/db-connection` or app schema).
- In tests, call `resetSequence()` in `beforeEach` or `beforeAll` if you need predictable IDs.
- Prefer traits for variants (admin, inactive) and seeds for fixed scenarios (john, demo data).
- When a field depends on another factory, wrap `use(...).create()` in a function so overrides (e.g. `create({ userId: x })`) do not create unnecessary rows.

## Reference

- Repository: [praha-inc/drizzle-factory](https://github.com/praha-inc/drizzle-factory)
- Package: [@praha/drizzle-factory](https://www.npmjs.com/package/@praha/drizzle-factory)
- License: MIT
