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
  // Replace the GET /secrets endpoint inside backend/src/routes.ts
  fastify.get('/secrets', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user;

    try {
      // 1. Fetch the user's profile to find their real organization ID
      const userRecord = db.select().from(users).where(eq(users.id, userId)).get();
      if (!userRecord) return reply.status(404).send({ error: "User profile not found." });
      const realOrgId = userRecord.organizationId;

      // 2. Grab all secrets matching this organization space
      const orgSecrets = db.select().from(secrets).where(eq(secrets.organizationId, realOrgId)).all();

      // 3. Find all teams this specific user belongs to
      const myTeams = db.select({ teamId: userTeams.teamId }).from(userTeams).where(eq(userTeams.userId, userId)).all();
      const teamIds = new Set(myTeams.map(t => t.teamId));

      // 4. Extract all active read authorization mappings
      const allAcls = db.select().from(acls).where(eq(acls.canRead, true)).all();

      // 5. JavaScript filtering (100% predictable, no ORM compilation quirks)
      const visibleSecrets = orgSecrets.filter(secret => {
        // Condition A: You are the absolute creator/owner of the secret
        if (secret.ownerId === userId) return true;

        // Condition B: The secret matches your User, Team, or Org visibility tags
        const secretAcls = allAcls.filter(a => a.secretId === secret.id);
        for (const acl of secretAcls) {
          if (acl.targetType === 'USER' && acl.targetId === userId) return true;
          if (acl.targetType === 'ORG' && acl.targetId === realOrgId) return true;
          if (acl.targetType === 'TEAM' && teamIds.has(acl.targetId)) return true;
        }

        return false;
      });

      return { secrets: visibleSecrets };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to evaluate secure secret access mappings.' });
    }
  });

  fastify.post('/secrets', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user;
    type Permission = { targetType: 'USER' | 'TEAM' | 'ORG', targetId: string, canRead: boolean, canWrite: boolean };
    const { key, value, permissions } = request.body as { key: string; value: string; permissions?: Permission[] };

    if (!key || !value) return reply.status(400).send({ error: 'Key and Value required.' });

    try {
      const userRecord = db.select().from(users).where(eq(users.id, userId)).get();
      const realOrgId = userRecord!.organizationId;

      const result = db.transaction((tx) => {
        const newSecret = tx.insert(secrets).values({ key, value, ownerId: userId, organizationId: realOrgId }).returning().get();
        if (!newSecret) throw new Error('Database failed to return the created secret.');

        if (permissions && permissions.length > 0) {
          const aclInserts = permissions.map(p => ({
            secretId: newSecret.id,
            targetType: p.targetType,
            // Automatically overwrite placeholder string with the user's active organization ID
            targetId: p.targetType === 'ORG' ? realOrgId : p.targetId,
            canRead: p.canRead ?? false,
            canWrite: p.canWrite ?? false
          }));
          tx.insert(acls).values(aclInserts).run();
        }
        return newSecret;
      });
      return { success: true, secret: result };
    } catch (error) {
      fastify.log.error(error);
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

  // POST /secrets/:secretId/permissions - Add access rules to an existing secret
  fastify.post('/secrets/:secretId/permissions', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user;
    const { secretId } = request.params as { secretId: string };
    const { targetType, targetId, action } = request.body as { 
      targetType: 'USER' | 'TEAM' | 'ORG'; 
      targetId: string; 
      action: 'GRANT' | 'REVOKE'; 
    };

    if (!targetType || !targetId || !action) {
      return reply.status(400).send({ error: 'Target type, target ID, and explicit action (GRANT/REVOKE) are required.' });
    }

    try {
      // 1. Verify secret existence
      const secret = db.select().from(secrets).where(eq(secrets.id, secretId)).get();
      if (!secret) return reply.status(404).send({ error: 'Secret target not found.' });

      // 2. Validate authority bounds
      const userRecord = db.select().from(users).where(eq(users.id, userId)).get();
      const isAdmin = userRecord?.isAdmin;

      if (secret.ownerId !== userId && !isAdmin) {
        return reply.status(403).send({ error: 'Access Denied: You do not own this secret.' });
      }

      const realOrgId = userRecord!.organizationId;
      const finalTargetId = targetType === 'ORG' ? realOrgId : targetId;

      // 3. Perform Transactional Mutation
      db.transaction((tx) => {
        // Always clear any matching older record first to avoid duplication conflicts
        tx.delete(acls).where(
          and(
            eq(acls.secretId, secretId),
            eq(acls.targetType, targetType),
            eq(acls.targetId, finalTargetId)
          )
        ).run();

        // If the action is GRANT, write the active permission line
        if (action === 'GRANT') {
          tx.insert(acls).values({
            secretId,
            targetType,
            targetId: finalTargetId,
            canRead: true,
            canWrite: true
          }).run();
        }
      });

      return { success: true };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to process security policy modifications.' });
    }
  });

  // FIXED: DELETE /admin/teams/:teamId
  fastify.delete('/admin/teams/:teamId', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdmin(request.user.userId)) return reply.status(403).send({ error: 'Admin only' });
    const { teamId } = request.params as { teamId: string };

    try {
      db.delete(userTeams).where(eq(userTeams.teamId, teamId)).run();
      db.delete(acls).where(and(eq(acls.targetType, 'TEAM'), eq(acls.targetId, teamId))).run();
      
      const result = db.delete(teams).where(eq(teams.id, teamId)).returning().get();

      if (!result) {
        return reply.status(404).send({ error: 'Team not found in database' });
      }

      return { success: true, deletedTeam: result };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to delete team due to database constraints.' });
    }
  });

  fastify.delete('/admin/users/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdmin(request.user.userId)) return reply.status(403).send({ error: 'Admin only' });
    const { userId } = request.params as { userId: string };

    try {
      // Execute sequentially without a complex transaction to isolate failures
      db.delete(userTeams).where(eq(userTeams.userId, userId)).run();
      db.delete(acls).where(and(eq(acls.targetType, 'USER'), eq(acls.targetId, userId))).run();
      db.delete(secrets).where(eq(secrets.ownerId, userId)).run();
      
      const result = db.delete(users).where(eq(users.id, userId)).returning().get();
      
      if (!result) {
        return reply.status(444).send({ error: 'User not found in database' });
      }

      return { success: true, deletedUser: result };
    } catch (error) {
      fastify.log.error(error); // This will spit out the real SQLite error in your backend logs
      return reply.status(500).send({ error: 'Failed to delete user due to database constraints.' });
    }
  });

}



