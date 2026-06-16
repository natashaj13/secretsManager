import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  githubId: text('github_id').notNull().unique(),
  isAdmin: integer('is_admin', { mode: 'boolean' }).default(false),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
});

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
});

//maps users to teams for n:n relationship
export const userTeams = sqliteTable('user_teams', {
  userId: text('user_id').notNull().references(() => users.id),
  teamId: text('team_id').notNull().references(() => teams.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.teamId] }),
}));

export const secrets = sqliteTable('secrets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: text('key').notNull(),
  value: text('value').notNull(),
  ownerId: text('owner_id').notNull().references(() => users.id),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
});

//secrets table (who has access to what)
export const acls = sqliteTable('acls', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  secretId: text('secret_id').notNull().references(() => secrets.id),
  targetType: text('target_type').notNull(), 
  targetId: text('target_id').notNull(),
  canRead: integer('can_read', { mode: 'boolean' }).default(true),
  canWrite: integer('can_write', { mode: 'boolean' }).default(false),
});