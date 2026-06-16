import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.secret-manager-token.json');
const BASE_URL = 'http://localhost:4000';

// For GET and DELETE requests (for no body requests)
function getAuthHeader() {
  const token = getSavedToken();
  return { 'Authorization': `Bearer ${token}` };
}

// For POST and PUT requests (for requests with JSON body)
function getJsonHeaders() {
  const token = getSavedToken();
  return { 
    'Authorization': `Bearer ${token}`, 
    'Content-Type': 'application/json' 
  };
}

function getSavedToken(): string | null {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(data).token || null;
    }
  } catch (e) {
    return null;
  }
  return null;
}

//Fetch authorized secrets from backend
export const fetchSecrets = async () => {
  const res = await fetch(`${BASE_URL}/secrets`, { 
    method: 'GET', 
    headers: getAuthHeader()
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: 'Server error' }));
    throw new Error(errData.error || `HTTP Error ${res.status}`);
  }

  return res.json();
};

// Create new secret pair
export async function createSecret(key: string, value: string) {
  const token = getSavedToken();
  if (!token) throw new Error('Not authenticated');

  const response = await fetch(`${BASE_URL}/secrets`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ key, value })
  });

  if (!response.ok) throw new Error('Failed to save secret');
  return await response.json();
}

// Add permissions for a secret
export const apiAddSecretPermission = async (secretId: string, targetType: string, targetId: string) => {
  return fetch(`${BASE_URL}/secrets/${secretId}/permissions`, {
    method: 'POST',
    headers: getJsonHeaders(), 
    body: JSON.stringify({ targetType, targetId, canRead: true, canWrite: true })
  });
};

//logout
export function logout() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      fs.unlinkSync(CONFIG_PATH);
    }
    return true;
  } catch (err) {
    return false;
  }
}

//list users and teams for org
export async function fetchDirectory() {
  const token = getSavedToken();
  const response = await fetch(`${BASE_URL}/directory`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return await response.json(); 
}


//make user an admin
export async function promoteUser(targetUserId: string) {
  const token = getSavedToken();
  await fetch(`${BASE_URL}/admin/users/promote`, {
    method: 'PUT',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify({ targetUserId })
  });
}


export const apiCreateUser = async (email: string) => fetch(`${BASE_URL}/admin/users`, { method: 'POST', headers: getJsonHeaders(), body: JSON.stringify({ email }) });
export const apiCreateTeam = async (name: string) => fetch(`${BASE_URL}/admin/teams`, { method: 'POST', headers: getJsonHeaders(), body: JSON.stringify({ name }) });
export const apiAssignUser = async (userId: string, teamId: string) => fetch(`${BASE_URL}/admin/teams/${teamId}/members`, { method: 'POST', headers: getJsonHeaders(), body: JSON.stringify({ targetUserId: userId }) });
export const apiPromoteUser = async (userId: string) => fetch(`${BASE_URL}/admin/users/${userId}/promote`, { method: 'PUT', headers: getAuthHeader() });

export const apiDeleteUser = async (userId: string) => fetch(`${BASE_URL}/admin/users/${userId}`, { method: 'DELETE', headers: getAuthHeader() });
export const apiDeleteTeam = async (teamId: string) => fetch(`${BASE_URL}/admin/teams/${teamId}`, { method: 'DELETE', headers: getAuthHeader() }); 

export const apiCreateSecret = async (key: string, value: string, permissions: any[]) => fetch(`${BASE_URL}/secrets`, { method: 'POST', headers: getJsonHeaders(), body: JSON.stringify({ key, value, permissions }) });

export const apiManageSecretPermission = async (secretId: string, targetType: string, targetId: string, action: 'GRANT' | 'REVOKE') => {
  return fetch(`${BASE_URL}/secrets/${secretId}/permissions`, {
    method: 'POST',
    headers: getJsonHeaders(),
    body: JSON.stringify({ targetType, targetId, action })
  });
};

function getHeaders() {
  const token = getSavedToken(); 
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}