import React, { useState, useEffect } from 'react';
import { Text, Box, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import fs from 'fs';
import path from 'path';

// API imports (Ensure your api.ts exports these matching functions)
import { startAuthFlow } from './auth-server.js';
import { 
  fetchSecrets, fetchDirectory, logout, 
  apiCreateUser, apiCreateTeam, apiAssignUser, 
  apiDeleteUser, apiDeleteTeam, apiPromoteUser, apiCreateSecret 
} from './api.js';

const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.secret-manager-token.json');

// ==========================================
// MAIN APP COMPONENT
// ==========================================
export default function App() {
  const { exit } = useApp();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentView, setCurrentView] = useState('LOGIN');
  
  const [secrets, setSecrets] = useState<any[]>([]);
  const [directory, setDirectory] = useState({ users: [], teams: [] });

  useEffect(() => {
    if (fs.existsSync(CONFIG_PATH)) {
      setIsAuthenticated(true);
      checkAdminStatus();
    }
  }, []);

  const checkAdminStatus = async () => {
    setLoading(true);
    try {
      const data = await fetchDirectory();
      setDirectory(data);
      const token = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')).token;
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      const myProfile = data.users.find((u: any) => u.id === payload.userId);
      if (myProfile?.isAdmin) setIsAdmin(true);
      setCurrentView('MENU');
    } catch (err) {
      handleLogout();
    }
    setLoading(false);
  };

  const handleLogin = () => {
    setLoading(true);
    startAuthFlow(async () => {
      setIsAuthenticated(true);
      await checkAdminStatus();
    });
  };

  const handleLogout = () => {
    logout();
    setIsAuthenticated(false);
    setIsAdmin(false);
    setCurrentView('LOGIN');
  };

  const loadSecrets = async () => {
    setLoading(true);
    try {
      const data = await fetchSecrets();
      setSecrets(data.secrets || []); 
      setCurrentView('LIST_SECRETS');
    } catch (err) { handleLogout(); }
    setLoading(false);
  };

  const goMenu = () => setCurrentView('MENU');

  if (loading) return <Text color="yellow">Loading... Please wait.</Text>;

  if (currentView === 'LOGIN') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">🔒 SECRETS MANAGER CLI</Text>
        <Box marginTop={1}>
          <SelectInput
            items={[{ label: '🚀 Login with GitHub', value: 'login' }, { label: '❌ Exit', value: 'exit' }]}
            onSelect={(item) => { item.value === 'login' ? handleLogin() : exit(); }}
          />
        </Box>
      </Box>
    );
  }

  if (currentView === 'MENU') {
    const adminItems = [
      { label: '📁 View My Secrets', value: 'list_secrets' },
      { label: '👤 Create User', value: 'create_user' },
      { label: '🛡️  Create Team', value: 'create_team' },
      { label: '🔗 Assign User to Team', value: 'assign_user' },
      { label: '🗑️  Delete User', value: 'delete_user' },
      { label: '🗑️  Delete Team', value: 'delete_team' },
      { label: '⭐ Promote User to Admin', value: 'promote_user' },
      { label: '➕ Create Secret', value: 'create_secret' },
      { label: '👥 List All Teams and Users', value: 'directory' },
      { label: '🚪 Logout', value: 'logout' },
      { label: '❌ Exit', value: 'exit' }
    ];

    const userItems = [
      { label: '📁 View My Secrets', value: 'list_secrets' },
      { label: '➕ Create Secret (with Read/Write Auth)', value: 'create_secret' },
      { label: '👥 List All Teams and Users', value: 'directory' },
      { label: '🚪 Logout', value: 'logout' },
      { label: '❌ Exit', value: 'exit' }
    ];

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={isAdmin ? "red" : "green"}>✅ Authenticated as {isAdmin ? "ADMINISTRATOR" : "Standard User"}</Text>
        <Box marginTop={1}>
          <SelectInput
            items={isAdmin ? adminItems : userItems}
            onSelect={(item) => {
              if (item.value === 'logout') handleLogout();
              else if (item.value === 'exit') exit();
              else if (item.value === 'list_secrets') loadSecrets();
              else setCurrentView(item.value.toUpperCase()); 
            }}
          />
        </Box>
      </Box>
    );
  }

  // --- ROUTING TO SUB-VIEWS ---
  return (
    <Box flexDirection="column" padding={1}>
      {currentView === 'LIST_SECRETS' && <ListSecretsView secrets={secrets} onBack={goMenu} />}
      {currentView === 'DIRECTORY' && <DirectoryView directory={directory} onBack={goMenu} />}
      {currentView === 'CREATE_USER' && <CreateUserView onBack={goMenu} />}
      {currentView === 'CREATE_TEAM' && <CreateTeamView onBack={goMenu} />}
      {currentView === 'PROMOTE_USER' && <SelectActionView title="Promote User to Admin" items={directory.users.map((u:any)=>({label: u.email, value: u.id}))} action={apiPromoteUser} onBack={goMenu} />}
      {currentView === 'DELETE_USER' && <SelectActionView title="Delete User" items={directory.users.map((u:any)=>({label: u.email, value: u.id}))} action={apiDeleteUser} onBack={goMenu} />}
      {currentView === 'DELETE_TEAM' && <SelectActionView title="Delete Team" items={directory.teams.map((t:any)=>({label: t.name, value: t.id}))} action={apiDeleteTeam} onBack={goMenu} />}
      {currentView === 'ASSIGN_USER' && <AssignUserView directory={directory} onBack={goMenu} />}
      {currentView === 'CREATE_SECRET' && <CreateSecretView directory={directory} onBack={goMenu} />}
    </Box>
  );
}

// ==========================================
// SUB-VIEW COMPONENTS
// ==========================================

function ListSecretsView({ secrets, onBack }: { secrets: any[], onBack: () => void }) {
  return (
    <>
      <Text bold color="cyan">📁 Your Authorized Secrets</Text>
      <Box flexDirection="column" marginY={1} padding={1} borderStyle="round" borderColor="gray">
        {secrets.length === 0 ? <Text color="yellow">No secrets found.</Text> : (
          secrets.map((s, i) => <Text key={i}>🔑 <Text bold color="green">{s.key}</Text> : {s.value}</Text>)
        )}
      </Box>
      <SelectInput items={[{ label: '⬅️  Back to Menu', value: 'back' }]} onSelect={onBack} />
    </>
  );
}

function DirectoryView({ directory, onBack }: { directory: any, onBack: () => void }) {
  return (
    <>
      <Text bold color="cyan">👥 Organization Directory</Text>
      <Box marginY={1} flexDirection="column">
        <Text bold underline>Users:</Text>
        {directory.users.map((u: any) => <Text key={u.id}>- {u.email} {u.isAdmin ? '(Admin)' : ''}</Text>)}
        <Box marginTop={1}>
          <Text bold underline>Teams:</Text>
        </Box>
        {directory.teams.map((t: any) => <Text key={t.id}>- {t.name}</Text>)}
      </Box>
      <SelectInput items={[{ label: '⬅️  Back to Menu', value: 'back' }]} onSelect={onBack} />
    </>
  );
}

// Reusable text input form for simple creations
function CreateUserView({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  return (
    <>
      <Text bold color="cyan">👤 Create New User</Text>
      {!done ? (
        <Box>
          <Text>Enter Email: </Text>
          <TextInput value={email} onChange={setEmail} onSubmit={async () => {
            await apiCreateUser(email);
            setDone(true);
          }} />
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color="green">✅ User created successfully!</Text>
          <SelectInput items={[{ label: '⬅️  Back to Menu', value: 'back' }]} onSelect={onBack} />
        </Box>
      )}
    </>
  );
}

function CreateTeamView({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState('');
  const [done, setDone] = useState(false);

  return (
    <>
      <Text bold color="cyan">🛡️ Create New Team</Text>
      {!done ? (
        <Box>
          <Text>Enter Team Name: </Text>
          <TextInput value={name} onChange={setName} onSubmit={async () => {
            await apiCreateTeam(name);
            setDone(true);
          }} />
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color="green">✅ Team created successfully!</Text>
          <SelectInput items={[{ label: '⬅️  Back to Menu', value: 'back' }]} onSelect={onBack} />
        </Box>
      )}
    </>
  );
}

// Reusable list selector for Deleting / Promoting
function SelectActionView({ title, items, action, onBack }: { title: string, items: any[], action: (id: string) => Promise<any>, onBack: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <>
      <Text bold color="red">{title}</Text>
      {!done ? (
        <SelectInput items={[...items, {label: '⬅️ Cancel', value: 'cancel'}]} onSelect={async (item) => {
          if (item.value === 'cancel') return onBack();
          await action(item.value as string);
          setDone(true);
        }} />
      ) : (
        <Box flexDirection="column">
          <Text color="green">✅ Action completed successfully!</Text>
          <SelectInput items={[{ label: '⬅️  Back to Menu', value: 'back' }]} onSelect={onBack} />
        </Box>
      )}
    </>
  );
}

function AssignUserView({ directory, onBack }: { directory: any, onBack: () => void }) {
  const [step, setStep] = useState(1);
  const [userId, setUserId] = useState('');

  if (step === 1) {
    return (
      <>
        <Text bold color="cyan">Step 1: Select User to Assign</Text>
        <SelectInput items={[...directory.users.map((u:any)=>({label: u.email, value: u.id})), {label: '⬅️ Cancel', value: 'cancel'}]} 
          onSelect={(item) => {
            if (item.value === 'cancel') return onBack();
            setUserId(item.value as string);
            setStep(2);
          }} 
        />
      </>
    );
  }

  return (
    <>
      <Text bold color="cyan">Step 2: Select Team</Text>
      <SelectInput items={directory.teams.map((t:any)=>({label: t.name, value: t.id}))} 
        onSelect={async (item) => {
          await apiAssignUser(userId, item.value as string);
          setStep(3);
        }} 
      />
      {step === 3 && <Text color="green">✅ User assigned to team! Press Ctrl+C to exit or restart.</Text>}
    </>
  );
}

function CreateSecretView({ directory, onBack }: { directory: any, onBack: () => void }) {
  const [step, setStep] = useState(1);
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  const [target, setTarget] = useState<any>(null); // Who are we sharing with?

  if (step === 1) return <Box><Text>Enter Secret Key: </Text><TextInput value={key} onChange={setKey} onSubmit={()=>setStep(2)}/></Box>;
  if (step === 2) return <Box><Text>Enter Secret Value: </Text><TextInput value={val} onChange={setVal} onSubmit={()=>setStep(3)}/></Box>;
  if (step === 3) {
    const targets = [
      { label: 'Just Me (Private)', value: { type: 'NONE', id: '' } },
      { label: 'Entire Organization', value: { type: 'ORG', id: 'org' } }, // Simplified ORG target
      ...directory.teams.map((t:any)=>({label: `Team: ${t.name}`, value: { type: 'TEAM', id: t.id }})),
      ...directory.users.map((u:any)=>({label: `User: ${u.email}`, value: { type: 'USER', id: u.id }}))
    ];
    return (
      <>
        <Text bold>Who should have READ/WRITE access to this?</Text>
        <SelectInput items={targets} onSelect={(item) => {
          setTarget(item.value);
          setStep(4);
        }}/>
      </>
    );
  }
  
  if (step === 4) {
    // Auto-submit the API call
    apiCreateSecret(key, val, target.type !== 'NONE' ? [{ targetType: target.type, targetId: target.id, canRead: true, canWrite: true }] : []).then(() => setStep(5));
    return <Text>Saving...</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color="green">✅ Secret created and secured!</Text>
      <SelectInput items={[{ label: '⬅️  Back to Menu', value: 'back' }]} onSelect={onBack} />
    </Box>
  );
}