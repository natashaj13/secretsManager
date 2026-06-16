1. Backend Setup
Navigate into the backend directory and install the dependencies:

Bash
cd backend
npm install
Create a .env file in the root of the backend/ folder and paste your exact environment variables:

Code snippet
GITHUB_CLIENT_ID="id"
GITHUB_CLIENT_SECRET="secret"
JWT_SECRET="your-secret-key"

Initialize your SQLite database structure using Drizzle Kit:
Bash
# Generate the SQL migration files
npx drizzle-kit generate

# Push the schema changes directly to your local SQLite file
npx drizzle-kit push
Start the backend development server:

Bash
npx tsx src/server.ts

2. CLI Setup
Open a new terminal window or split pane, navigate to the cli/ directory, and install its dependencies:

Bash
cd cli
npm install

Launch the interactive terminal user interface:

Bash
npx tsx src/index.tsx