import 'dotenv/config'
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import fastifyOauth2, { OAuth2Namespace } from '@fastify/oauth2';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';

import { db } from './db';
import { users, organizations } from './db/schema';
import { secretRoutes } from './routes'; // Import your clean external routes file

const fastify = Fastify({ logger: true });
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key';

// --- TYPE MERGING ---
declare module 'fastify' {
  interface FastifyInstance {
    githubOAuth2: OAuth2Namespace;
  }
  interface FastifyRequest {
    user: { userId: string; orgId: string };
  }
}

// --- OAUTH2 PLUGIN REGISTRATION ---
fastify.register(fastifyOauth2, {
  name: 'githubOAuth2',
  credentials: {
    client: {
      id: process.env.GITHUB_CLIENT_ID || 'MOCK_ID',
      secret: process.env.GITHUB_CLIENT_SECRET || 'MOCK_SECRET'
    },
    auth: fastifyOauth2.GITHUB_CONFIGURATION
  },
  startRedirectPath: '/login/github',
  callbackUri: 'http://localhost:4000/login/github/callback'
});

// --- REGISTER EXTERNAL ROUTES ---
// This safely mounts the GET /secrets and POST /secrets routes from your routes.ts file
fastify.register(secretRoutes);

// --- ROUTES ---

// The GitHub OAuth Callback
// The GitHub OAuth Callback
fastify.get('/login/github/callback', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    // 1. Exchange the temporary code from GitHub for an official access token
    const tokenResult = await fastify.githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
    
    // 2. Fetch the user's GitHub profile data using the access token
    const userResponse = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenResult.token.access_token}` }
    });
    
    if (!userResponse.ok) {
      throw new Error('Failed to fetch user profile from GitHub');
    }
    
    const githubProfile = await userResponse.json() as any;
    const githubIdStr = String(githubProfile.id);

    // 3. Look up or create the user in your SQLite Database
    let user = await db.select().from(users).where(eq(users.githubId, githubIdStr)).get();
    
    if (!user) {
      // Auto-create a default org if none exist
      let org = await db.select().from(organizations).get();
      if (!org) {
        [org] = await db.insert(organizations).values({ name: 'Default Organization' }).returning();
      }
      
      // Provision the new user profile
      [user] = await db.insert(users).values({
        email: githubProfile.email || `${githubProfile.login}@github.com`,
        githubId: githubIdStr,
        organizationId: org.id,
        isAdmin: true 
      }).returning();
    }

    // 4. Generate your internal secure JWT application token
    const appToken = jwt.sign({ userId: user.id, orgId: user.organizationId }, JWT_SECRET, { expiresIn: '7d' });

    // 5. Redirect the browser back to your local CLI's listening server on port 5123
    // We hardcode 5123 here because that is the fixed port your CLI auth-server listens on!
    reply.redirect(`http://localhost:5123/callback?token=${appToken}`);

  } catch (error) {
    fastify.log.error(error);
    reply.status(500).send({ error: 'Authentication failed internally' });
  }
});

// --- START SERVER ---
const start = async () => {
  try {
    await fastify.listen({ port: 4000 });
    console.log(`Server listening at http://localhost:4000`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();