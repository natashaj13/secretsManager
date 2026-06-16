import 'dotenv/config'
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import fastifyOauth2, { OAuth2Namespace } from '@fastify/oauth2';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';

import { db } from './db';
import { users, organizations } from './db/schema';
import { secretRoutes } from './routes'; 

const fastify = Fastify({ logger: true });
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key';

//initlaize fastify and set up oath2 for github
declare module 'fastify' {
  interface FastifyInstance {
    githubOAuth2: OAuth2Namespace;
  }
  interface FastifyRequest {
    user: { userId: string; orgId: string };
  }
}

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

fastify.register(secretRoutes);


// ROUTES

// login with Github
fastify.get('/login/github/callback', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    // Get access token
    const tokenResult = await fastify.githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
    
    // Fetch github profile
    const userResponse = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenResult.token.access_token}` }
    });
    
    if (!userResponse.ok) {
      throw new Error('Failed to fetch user profile from GitHub');
    }
    
    const githubProfile = await userResponse.json() as any;
    const githubIdStr = String(githubProfile.id);

    // Look up or create the user in db
    let user = await db.select().from(users).where(eq(users.githubId, githubIdStr)).get();
    
    if (!user) {
      // Create default org if none exist
      let org = await db.select().from(organizations).get();
      if (!org) {
        [org] = await db.insert(organizations).values({ name: 'Default Organization' }).returning();
      }
      
      // Set up the new user profile
      [user] = await db.insert(users).values({
        email: githubProfile.email || `${githubProfile.login}@github.com`,
        githubId: githubIdStr,
        organizationId: org.id,
        isAdmin: true 
      }).returning();
    }

    // Generate JWT application token
    const appToken = jwt.sign({ userId: user.id, orgId: user.organizationId }, JWT_SECRET, { expiresIn: '7d' });

    // Redirect browser back to CLI's server on port 5123
    reply.redirect(`http://localhost:5123/callback?token=${appToken}`);

  } catch (error) {
    fastify.log.error(error);
    reply.status(500).send({ error: 'Authentication failed internally' });
  }
});

// start server on port 4000
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