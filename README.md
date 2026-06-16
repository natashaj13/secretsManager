# Secrets Manager Setup

Follow these steps to initialize your local development environment. Ensure you have two separate terminal splits or windows open to run the services simultaneously.

---

## 1. Backend Service Setup

### Install Dependencies

Navigate into the backend project root and install the required modules:

```bash
cd backend
npm install

```

### Configure Environment

Create a `.env` file in the root of your `backend/` folder and populate it with your GitHub OAuth and JWT security strings:

```env
GITHUB_CLIENT_ID="id"
GITHUB_CLIENT_SECRET="secret"
JWT_SECRET="your-secret-key"

```

### Database Initialization

Generate your migration files and sync your local SQLite file layout directly using Drizzle Kit:

```bash
npx drizzle-kit generate
npx drizzle-kit push

```

### Start the Server

Set up the main Fastify API compiler engine:

```bash
npx tsx src/server.ts

```

> *Keep this terminal open. The backend must be active for the CLI tool to authenticate and communicate.*

---

## 2. CLI Tool Setup

### Install Dependencies

Open a secondary split terminal window, change into the `cli/` project directory, and pull down its rendering wrappers:

```bash
cd cli
npm install

```

### Launch Terminal User Interface

Boot the interactive React Ink UI matrix framework directly inside your shell prompt:

```bash
npx tsx src/index.tsx

```

---

### Navigation Tips

* Use the **Up/Down Arrow Keys** to hover over options in the menu.
* Press **Enter** to select an action or submit input fields.
* To exit the interface cleanly at any point, select the `Quit` prompt or press `Ctrl + C`.