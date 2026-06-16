import React, { useState, useEffect } from 'react';
import { Text, Box, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import fs from 'fs';
import path from 'path';

import { startAuthFlow } from './auth-server.js';
import { 
  fetchSecrets, fetchDirectory, logout, 
  apiCreateUser, apiCreateTeam, apiAssignUser, 
  apiDeleteUser, apiDeleteTeam, apiPromoteUser, apiCreateSecret, apiManageSecretPermission
} from './api.js';

const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.secret-manager-token.json');



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

  //check if user is admin
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

  //get authorized secrets
  const loadSecrets = async () => {
    setLoading(true);
    try {
      const data = await fetchSecrets();
      setSecrets(data.secrets || []); 
      setCurrentView('LIST_SECRETS');
    } catch (err) { handleLogout(); }
    setLoading(false);
  };

  //used for modifying secrets permisions
  const loadSecretsForPermissions = async () => {
    setLoading(true);
    try {
      const data = await fetchSecrets();
      setSecrets(data.secrets || []);
      setCurrentView('MANAGE_PERMISSIONS');
    } catch (err) { handleLogout(); }
    setLoading(false);
  };

  //main menu
  const goMenu = async () => {
    try {
      const data = await fetchDirectory();
      setDirectory(data); 
    } catch (err) {
      console.error("Failed to refresh directory data");
    }
    setCurrentView('MENU');
  };


  // VIEWS

  if (loading) return <Text color="yellow">Loading... Please wait.</Text>;

  if (currentView === 'LOGIN') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">SECRETS MANAGER CLI TOOL</Text>
        <Box marginTop={1}>
          <SelectInput
            items={[{ label: 'Login with GitHub', value: 'login' }, { label: 'Exit', value: 'exit' }]}
            onSelect={(item) => { item.value === 'login' ? handleLogin() : exit(); }}
          />
        </Box>
      </Box>
    );
  }

  if (currentView === 'MENU') {
    const adminItems = [
      { label: 'View My Secrets', value: 'list_secrets' },
      { label: 'Create Secret', value: 'create_secret' },
      { label: 'Manage Secret Permissions\n', value: 'manage_permissions' },
      { label: 'Create User', value: 'create_user' },
      { label: 'Create Team', value: 'create_team' },
      { label: 'Delete User', value: 'delete_user' },
      { label: 'Delete Team\n', value: 'delete_team' },
      { label: 'Assign User to Team', value: 'assign_user' },
      { label: 'Promote User to Admin', value: 'promote_user' },
      { label: 'List All Teams and Users\n', value: 'directory' },
      { label: 'Logout', value: 'logout' },
      { label: 'Quit', value: 'exit' }
    ];

    const userItems = [
      { label: 'View My Secrets', value: 'list_secrets' },
      { label: 'Create Secret', value: 'create_secret' },
      { label: 'Manage Secret Permissions\n', value: 'manage_permissions' },
      { label: 'List All Teams and Users\n', value: 'directory' },
      { label: 'Logout', value: 'logout' },
      { label: 'Quit', value: 'exit' }
    ];

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={isAdmin ? "red" : "green"}>Authenticated as {isAdmin ? "ADMINISTRATOR" : "Standard User"}</Text>
        <Box marginTop={1}>
          <SelectInput
            items={isAdmin ? adminItems : userItems}
            onSelect={(item) => {
              if (item.value === 'logout') handleLogout();
              else if (item.value === 'exit') exit();
              else if (item.value === 'list_secrets') loadSecrets();
              else if (item.value === 'manage_permissions') loadSecretsForPermissions();
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
      {currentView === 'MANAGE_PERMISSIONS' && <ManagePermissionsView secrets={secrets} directory={directory} onBack={goMenu} />}
    </Box>
  );
}

// ==========================================
// SUB-VIEW COMPONENTS
// ==========================================


//show list of secrets user has access to
function ListSecretsView({ secrets, onBack }: { secrets: any[], onBack: () => void }) {
  return (
    <>
      <Text bold color="cyan">Your Authorized Secrets</Text>
      <Box flexDirection="column" marginY={1} padding={1} borderStyle="round" borderColor="gray">
        {secrets.length === 0 ? <Text color="yellow">No secrets found.</Text> : (
          secrets.map((s, i) => <Text key={i}><Text bold color="green">{s.key}</Text> : {s.value}</Text>)
        )}
      </Box>
      <SelectInput items={[{ label: '⬅ Back to Menu', value: 'back' }]} onSelect={onBack} />
    </>
  );
}

//main menu
function DirectoryView({ directory, onBack }: { directory: any; onBack: () => void }) {
  const usersList = directory?.users || [];
  const teamsList = directory?.teams || [];
  const userTeamsLinks = directory?.userTeams || [];

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* users */}
      <Box borderStyle="single" borderColor="cyan" paddingX={1} flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">USERS ({usersList.length})</Text>
        <Text dimColor>──────────────────────────────────────────</Text>
        {usersList.length === 0 ? (
          <Text italic color="gray">No users in this organization.</Text>
        ) : (
          usersList.map((user: any) => (
            <Box key={user.id} marginLeft={2}>
              <Text color="white">• {user.email}</Text>
              {user.isAdmin && <Text color="yellow" bold> [ADMIN]</Text>}
            </Box>
          ))
        )}
      </Box>

      {/* team-user mapping */}
      <Box borderStyle="single" borderColor="magenta" paddingX={1} flexDirection="column" marginBottom={1}>
        <Text bold color="magenta">TEAMS & ASSIGNED MEMBERS ({teamsList.length})</Text>
        <Text dimColor>──────────────────────────────────────────</Text>
        {teamsList.length === 0 ? (
          <Text italic color="gray">No teams created</Text>
        ) : (
          teamsList.map((team: any) => {
            
            const assignedUserIds = userTeamsLinks
              .filter((ut: any) => ut.teamId === team.id)
              .map((ut: any) => ut.userId);

            const teamMembers = usersList.filter((user: any) => assignedUserIds.includes(user.id));

            return (
              <Box key={team.id} flexDirection="column" marginBottom={1} marginLeft={1}>
                <Text bold color="white">Team: <Text color="magenta" bold>{team.name}</Text></Text>
                
                {teamMembers.length === 0 ? (
                  <Box marginLeft={4}>
                    <Text italic color="gray">↳ No users assigned to this team yet.</Text>
                  </Box>
                ) : (
                  teamMembers.map((member: any) => (
                    <Box key={member.id} marginLeft={4}>
                      <Text color="gray">↳ {member.email}</Text>
                    </Box>
                  ))
                )}
              </Box>
            );
          })
        )}
      </Box>

      <Box marginTop={1}>
        <SelectInput 
          items={[{ label: '⬅ Back to Menu', value: 'back' }]} 
          onSelect={onBack} 
        />
      </Box>
    </Box>
  );
}


//create new user
function CreateUserView({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  return (
    <>
      <Text bold color="cyan">Create New User</Text>
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
          <Text color="green">User created successfully</Text>
          <SelectInput items={[{ label: '⬅ Back to Menu', value: 'back' }]} onSelect={onBack} />
        </Box>
      )}
    </>
  );
}


//create new team
function CreateTeamView({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState('');
  const [done, setDone] = useState(false);

  return (
    <>
      <Text bold color="cyan">Create New Team</Text>
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
          <Text color="green">Team created successfully</Text>
          <SelectInput items={[{ label: '⬅ Back to Menu', value: 'back' }]} onSelect={onBack} />
        </Box>
      )}
    </>
  );
}

//generic view for actions needing a selection from options
function SelectActionView({ title, items, action, onBack }: { title: string, items: any[], action: (id: string) => Promise<any>, onBack: () => void }) {
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  return (
    <>
      <Text bold color="red">{title}</Text>
      {status === 'idle' && (
        <SelectInput items={[...items, {label: '⬅ Cancel', value: 'cancel'}]} onSelect={async (item) => {
          if (item.value === 'cancel') return onBack();
          
          const res = await action(item.value as string);
          if (res.ok) {
            setStatus('success');
          } else {
            const errData = await res.json().catch(() => ({ error: 'Unknown server error' }));
            setErrorMessage(errData.error || 'Server rejected the request');
            setStatus('error');
          }
        }} />
      )}

      {status === 'success' && (
        <Box flexDirection="column">
          <Text color="green">Action completed successfully</Text>
          <SelectInput items={[{ label: '⬅ Back to Menu', value: 'back' }]} onSelect={onBack} />
        </Box>
      )}

      {status === 'error' && (
        <Box flexDirection="column">
          <Text color="red">Operation Failed: {errorMessage}</Text>
          <SelectInput items={[{ label: '⬅ Back to Menu', value: 'back' }]} onSelect={onBack} />
        </Box>
      )}
    </>
  );
}


//assign user to team
function AssignUserView({ directory, onBack }: { directory: any, onBack: () => void }) {
  const [step, setStep] = useState(1);
  const [userId, setUserId] = useState('');

  if (step === 1) {
    return (
      <>
        <Text bold color="cyan">Step 1: Select User to Assign</Text>
        <SelectInput items={[...directory.users.map((u:any)=>({label: u.email, value: u.id})), {label: '⬅ Cancel', value: 'cancel'}]} 
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
      {step === 3 && <Text color="green">User assigned to team successfully</Text>}
      <SelectInput items={[{ label: '⬅ Back to Menu', value: 'back' }]} onSelect={onBack} />
    </>
  );
}


//create new secret and set permissions
function CreateSecretView({ directory, onBack }: { directory: any, onBack: () => void }) {
  const [step, setStep] = useState(1);
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  const handleSubmitSecret = async (targetSelection: any) => {
    setStatus('saving');
    try {
      const permissions = targetSelection.type !== 'NONE' 
        ? [{ targetType: targetSelection.type, targetId: targetSelection.id, canRead: true, canWrite: true }] 
        : [];

      await apiCreateSecret(key, val, permissions);
      setStatus('success');
      setStep(5);
    } catch (err) {
      setStatus('error');
    }
  };

  if (step === 1) {
    return (
      <Box>
        <Text>Enter Secret Key: </Text>
        <TextInput value={key} onChange={setKey} onSubmit={() => setStep(2)} />
      </Box>
    );
  }

  if (step === 2) {
    return (
      <Box>
        <Text>Enter Secret Value: </Text>
        <TextInput value={val} onChange={setVal} onSubmit={() => setStep(3)} />
      </Box>
    );
  }
  
  if (step === 3) {
    const targets = [
      { label: 'Just Me (Private)', value: 'NONE_id' },
      { label: 'Entire Organization', value: 'ORG_org' },
      ...directory.teams.map((t: any) => ({ label: `Team: ${t.name}`, value: `TEAM_${t.id}` })),
      ...directory.users.map((u: any) => ({ label: `User: ${u.email}`, value: `USER_${u.id}` }))
    ];
    
    return (
      <>
        <Text bold color="cyan">Who should have access to this?</Text>
        <SelectInput 
          items={targets} 
          onSelect={(item: any) => {
            const [type, id] = String(item.value).split('_');
            handleSubmitSecret({ type, id });
          }}
        />
      </>
    );
  }

  if (status === 'saving') {
    return <Text color="yellow">Saving secret securely</Text>;
  }

  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">Failed to create secret. Check backend server connectivity.</Text>
        <SelectInput items={[{ label: '⬅ Back to Menu', value: 'back' }]} onSelect={onBack} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green">Secret created and permissions set</Text>
      <Box marginTop={1}>
        <SelectInput items={[{ label: '⬅ Back to Menu', value: 'back' }]} onSelect={onBack} />
      </Box>
    </Box>
  );

}


//update secret permissions
function ManagePermissionsView({ secrets, directory, onBack }: { secrets: any[], directory: any, onBack: () => void }) {
  const [step, setStep] = useState(1);
  const [selectedSecretId, setSelectedSecretId] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<{ type: string; id: string } | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  const handleExecuteAction = async (action: 'GRANT' | 'REVOKE') => {
    if (!selectedTarget) return;
    setStatus('saving');
    
    const res = await apiManageSecretPermission(selectedSecretId, selectedTarget.type, selectedTarget.id, action);
    if (res.ok) {
      setStatus('success');
      setStep(4);
    } else {
      setStatus('error');
    }
  };

  if (secrets.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">You do not have or own any secrets available for policy distribution management.</Text>
        <SelectInput items={[{ label: '⬅ Back to Menu', value: 'back' }]} onSelect={onBack} />
      </Box>
    );
  }

  if (step === 1) {
    return (
      <>
        <Text bold color="cyan">Step 1: Select Secret to Manage</Text>
        <SelectInput 
          items={[...secrets.map(s => ({ label: `${s.key}`, value: s.id })), { label: '⬅ Cancel', value: 'cancel' }]} 
          onSelect={(item) => {
            if (item.value === 'cancel') return onBack();
            setSelectedSecretId(item.value);
            setStep(2);
          }}
        />
      </>
    );
  }

  if (step === 2) {
    const options = [
      { label: 'Entire Organization', value: 'ORG_org' },
      ...directory.teams.map((t: any) => ({ label: `Team: ${t.name}`, value: `TEAM_${t.id}` })),
      ...directory.users.map((u: any) => ({ label: `User: ${u.email}`, value: `USER_${u.id}` }))
    ];

    return (
      <>
        <Text bold color="cyan">Step 2: Select Target Scope</Text>
        <SelectInput 
          items={[...options, { label: '⬅ Back', value: 'back' }]} 
          onSelect={(item) => {
            if (item.value === 'back') return setStep(1);
            const [type, id] = String(item.value).split('_');
            setSelectedTarget({ type, id });
            setStep(3);
          }}
        />
      </>
    );
  }

  if (step === 3 && status === 'idle') {
    return (
      <>
        <Text bold color="cyan">Step 3: Choose Access Modification Action</Text>
        <Box marginBottom={1}>
          <Text dimColor>Target: {selectedTarget?.type} ({selectedTarget?.id})</Text>
        </Box>
        <SelectInput 
          items={[
            { label: 'Grant / Update Permissions (Allow Access)', value: 'GRANT' },
            { label: 'Revoke / Remove Permissions (Deny Access)', value: 'REVOKE' },
            { label: '⬅ Back to Target Selection', value: 'back' }
          ]} 
          onSelect={(item) => {
            if (item.value === 'back') return setStep(2);
            handleExecuteAction(item.value as 'GRANT' | 'REVOKE');
          }}
        />
      </>
    );
  }

  if (status === 'saving') return <Text color="yellow">Adjusting permissions</Text>;
  
  if (status === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">Authorization Error: Operation rejected. You can only manage policies for items you own.</Text>
        <SelectInput items={[{ label: '⬅ Back to Menu', value: 'back' }]} onSelect={onBack} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green">Access Control List updated successfully!</Text>
      <Box marginTop={1}>
        <SelectInput items={[{ label: '⬅ Back to Menu', value: 'back' }]} onSelect={onBack} />
      </Box>
    </Box>
  );
}