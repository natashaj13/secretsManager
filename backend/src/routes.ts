import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, or, and, inArray } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { db } from './db/index.js';
import { secrets, acls, userTeams, users, teams } from './db/schema.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key';

// --- MIDDLEWARE: AUTHENTICATION ---
const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing token' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; orgId: string };
    request.user = decoded;
  } catch (error) {
    return reply.status(401).send({ error: 'Invalid or expired session token' });
  }
};

export async function secretRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticate);

  // --- HELPER: ADMIN VERIFICATION ---
  const verifyAdmin = (userId: string) => {
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    return user?.isAdmin === true;
  };

  // ==========================================
  // SECTION 1: SECRETS & SCOPES
  // ==========================================

  // GET /secrets - List all K/V pairs you are authorized to see
  fastify.get('/secrets', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId, orgId } = request.user;

    const myTeams = db.select({ teamId: userTeams.teamId }).from(userTeams).where(eq(userTeams.userId, userId)).all();
    const teamIds = myTeams.map((t) => t.teamId);

    const aclConditions = [
      and(eq(acls.targetType, 'USER'), eq(acls.targetId, userId), eq(acls.canRead, true)),
      and(eq(acls.targetType, 'ORG'), eq(acls.targetId, orgId), eq(acls.canRead, true)),
    ];

    if (teamIds.length > 0) {
      aclConditions.push(and(eq(acls.targetType, 'TEAM'), inArray(acls.targetId, teamIds), eq(acls.canRead, true)));
    }

    const visibleSecrets = db.selectDistinct({ id: secrets.id, key: secrets.key, value: secrets.value })
      .from(secrets)
      .leftJoin(acls, eq(secrets.id, acls.secretId))
      .where(or(eq(secrets.ownerId, userId), or(...aclConditions)))
      .all();

    return { secrets: visibleSecrets };
  });

  // POST /secrets - Create secret with distinct READ/WRITE scopes
  fastify.post('/secrets', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId, orgId } = request.user;
    
    // The payload allows array of permissions, mixing users, teams, and orgs for both reads and writes
    type Permission = { targetType: 'USER' | 'TEAM' | 'ORG', targetId: string, canRead: boolean, canWrite: boolean };
    const { key, value, permissions } = request.body as { key: string; value: string; permissions?: Permission[] };

    if (!key || !value) return reply.status(400).send({ error: 'Key and Value required.' });

    try {
      const result = db.transaction((tx) => {
        const newSecret = tx.insert(secrets).values({ key, value, ownerId: userId, organizationId: orgId }).returning().get();
        if (!newSecret) throw new Error('Database failed to return the created secret.');

        if (permissions && permissions.length > 0) {
          const aclInserts = permissions.map(p => ({
            secretId: newSecret.id,
            targetType: p.targetType,
            targetId: p.targetId,
            canRead: p.canRead ?? false,
            canWrite: p.canWrite ?? false
          }));
          tx.insert(acls).values(aclInserts).run();
        }
        return newSecret;
      });
      return { success: true, secret: result };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to write secret transaction securely.' });
    }
  });

  // ==========================================
  // SECTION 2: DIRECTORY
  // ==========================================

  // GET /directory - User can list all teams and users in org
  fastify.get('/directory', async (request: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = request.user;
    const orgUsers = db.select({ id: users.id, email: users.email, isAdmin: users.isAdmin }).from(users).where(eq(users.organizationId, orgId)).all();
    const orgTeams = db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.organizationId, orgId)).all();
    return { users: orgUsers, teams: orgTeams };
  });

  // ==========================================
  // SECTION 3: ADMIN CONTROLS
  // ==========================================

  // POST /admin/users - Admin create user manually
  fastify.post('/admin/users', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdmin(request.user.userId)) return reply.status(403).send({ error: 'Admin only' });
    const { email, isAdmin } = request.body as { email: string, isAdmin: boolean };
    const newUser = db.insert(users).values({ email, organizationId: request.user.orgId, isAdmin: isAdmin || false, githubId: `manual_${Date.now()}` }).returning().get();
    return { success: true, user: newUser };
  });

  // POST /admin/teams - Admin create teams
  fastify.post('/admin/teams', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdmin(request.user.userId)) return reply.status(403).send({ error: 'Admin only' });
    const { name } = request.body as { name: string };
    const newTeam = db.insert(teams).values({ name, organizationId: request.user.orgId }).returning().get();
    return { success: true, team: newTeam };
  });

  // PUT /admin/users/:userId/promote - Admin promote other users to admin
  fastify.put('/admin/users/:targetUserId/promote', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdmin(request.user.userId)) return reply.status(403).send({ error: 'Admin only' });
    const { targetUserId } = request.params as { targetUserId: string };
    db.update(users).set({ isAdmin: true }).where(eq(users.id, targetUserId)).run();
    return { success: true };
  });

  // POST /admin/teams/:teamId/members - Admin assign/reassign users to teams
  fastify.post('/admin/teams/:teamId/members', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdmin(request.user.userId)) return reply.status(403).send({ error: 'Admin only' });
    const { teamId } = request.params as { teamId: string };
    const { targetUserId } = request.body as { targetUserId: string };
    db.insert(userTeams).values({ userId: targetUserId, teamId }).run();
    return { success: true };
  });

  // DELETE /admin/users/:userId - Admin delete users
  fastify.delete('/admin/users/:targetUserId', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdmin(request.user.userId)) return reply.status(403).send({ error: 'Admin only' });
    const { targetUserId } = request.params as { targetUserId: string };
    
    // SQLite transaction to cascade delete (removes them from teams and removes their owned secrets)
    db.transaction((tx) => {
      tx.delete(userTeams).where(eq(userTeams.userId, targetUserId)).run();
      tx.delete(secrets).where(eq(secrets.ownerId, targetUserId)).run();
      tx.delete(users).where(eq(users.id, targetUserId)).run();
    });
    return { success: true };
  });

  // DELETE /admin/teams/:teamId - Admin delete teams
  fastify.delete('/admin/teams/:teamId', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdmin(request.user.userId)) return reply.status(403).send({ error: 'Admin only' });
    const { teamId } = request.params as { teamId: string };
    
    db.transaction((tx) => {
      tx.delete(userTeams).where(eq(userTeams.teamId, teamId)).run();
      tx.delete(teams).where(eq(teams.id, teamId)).run();
    });
    return { success: true };
  });
}