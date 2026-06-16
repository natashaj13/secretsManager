import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, or, and, inArray } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { db } from './db/index.js';
import { secrets, acls, userTeams, users, teams } from './db/schema.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key';

// AUTHENTICATION MIDDLEWARE
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

  // check user is admin
  const verifyAdmin = (userId: string) => {
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    return user?.isAdmin === true;
  };

 
  // ==========================================
  // ROUTES 
  // ==========================================

  // GET /secrets - list all secrets you are allowed to see
  fastify.get('/secrets', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user;

    try {
      //get user's id, teams, and orgs to filter secrets they can see
      const userRecord = db.select().from(users).where(eq(users.id, userId)).get();
      if (!userRecord) return reply.status(404).send({ error: "User profile not found." });
      const realOrgId = userRecord.organizationId;

      const orgSecrets = db.select().from(secrets).where(eq(secrets.organizationId, realOrgId)).all();

      const myTeams = db.select({ teamId: userTeams.teamId }).from(userTeams).where(eq(userTeams.userId, userId)).all();
      const teamIds = new Set(myTeams.map(t => t.teamId));

      const allAcls = db.select().from(acls).where(eq(acls.canRead, true)).all();

      const visibleSecrets = orgSecrets.filter(secret => {
        //if you created secret or are allowed to see it
        if (secret.ownerId === userId) return true;

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

  // POST /secrets - create a new secret with permissions
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


  // GET /directory - show all teams and users in org
// backend/src/routes.ts

fastify.get('/directory', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { userId } = request.user;

    //find org based on user
    const userRecord = db.select().from(users).where(eq(users.id, userId)).get();
    if (!userRecord) return reply.status(404).send({ error: 'User workspace not found.' });
    const orgId = userRecord.organizationId;

    //get all users in org
    const orgUsers = db.select({
      id: users.id,
      email: users.email,
      isAdmin: users.isAdmin
    }).from(users).where(eq(users.organizationId, orgId)).all();

    //get all teams in org
    const orgTeams = db.select({
      id: teams.id,
      name: teams.name
    }).from(teams).where(eq(teams.organizationId, orgId)).all();

    //team-user mapping
    const teamIds = orgTeams.map(t => t.id);
    let bridgeLinks: any[] = [];
    
    if (teamIds.length > 0) {
      bridgeLinks = db.select()
        .from(userTeams)
        .where(inArray(userTeams.teamId, teamIds))
        .all();
    }

    return { 
      users: orgUsers, 
      teams: orgTeams, 
      userTeams: bridgeLinks 
    };

  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Failed to compile organization directory.' });
  }
});


  // POST /admin/users - create user if admin
  fastify.post('/admin/users', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdmin(request.user.userId)) return reply.status(403).send({ error: 'Admin only' });
    const { email, isAdmin } = request.body as { email: string, isAdmin: boolean };
    const newUser = db.insert(users).values({ email, organizationId: request.user.orgId, isAdmin: isAdmin || false, githubId: `manual_${Date.now()}` }).returning().get();
    return { success: true, user: newUser };
  });

  // POST /admin/teams - create team if admin
  fastify.post('/admin/teams', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdmin(request.user.userId)) return reply.status(403).send({ error: 'Admin only' });
    const { name } = request.body as { name: string };
    const newTeam = db.insert(teams).values({ name, organizationId: request.user.orgId }).returning().get();
    return { success: true, team: newTeam };
  });

  // PUT /admin/users/:userId/promote - admin promote other users to admin
  fastify.put('/admin/users/:targetUserId/promote', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdmin(request.user.userId)) return reply.status(403).send({ error: 'Admin only' });
    const { targetUserId } = request.params as { targetUserId: string };
    db.update(users).set({ isAdmin: true }).where(eq(users.id, targetUserId)).run();
    return { success: true };
  });

  // POST /admin/teams/:teamId/members - admin assign users to teams
  fastify.post('/admin/teams/:teamId/members', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdmin(request.user.userId)) return reply.status(403).send({ error: 'Admin only' });
    const { teamId } = request.params as { teamId: string };
    const { targetUserId } = request.body as { targetUserId: string };
    db.insert(userTeams).values({ userId: targetUserId, teamId }).run();
    return { success: true };
  });

  // POST /secrets/:secretId/permissions - modify secret access rules
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
      //if secret exists and you have access
      const secret = db.select().from(secrets).where(eq(secrets.id, secretId)).get();
      if (!secret) return reply.status(404).send({ error: 'Secret target not found.' });

      const userRecord = db.select().from(users).where(eq(users.id, userId)).get();
      const isAdmin = userRecord?.isAdmin;

      if (secret.ownerId !== userId && !isAdmin) {
        return reply.status(403).send({ error: 'Access Denied: You do not own this secret.' });
      }

      const realOrgId = userRecord!.organizationId;
      const finalTargetId = targetType === 'ORG' ? realOrgId : targetId;

      //modify permissions
      db.transaction((tx) => {
        //clear old record
        tx.delete(acls).where(
          and(
            eq(acls.secretId, secretId),
            eq(acls.targetType, targetType),
            eq(acls.targetId, finalTargetId)
          )
        ).run();

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


  //DELETE /admin/teams/:teamId - admin delete team
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


  //DELETE /admin/users/:userId - admin delete user
  fastify.delete('/admin/users/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdmin(request.user.userId)) return reply.status(403).send({ error: 'Admin only' });
    const { userId } = request.params as { userId: string };

    try {
      db.delete(userTeams).where(eq(userTeams.userId, userId)).run();
      db.delete(acls).where(and(eq(acls.targetType, 'USER'), eq(acls.targetId, userId))).run();
      db.delete(secrets).where(eq(secrets.ownerId, userId)).run();
      
      const result = db.delete(users).where(eq(users.id, userId)).returning().get();
      
      if (!result) {
        return reply.status(444).send({ error: 'User not found in database' });
      }

      return { success: true, deletedUser: result };
    } catch (error) {
      fastify.log.error(error); 
      return reply.status(500).send({ error: 'Failed to delete user due to database constraints.' });
    }
  });
}



