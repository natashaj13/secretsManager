import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import open from 'open';

const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.secret-manager-token.json');

export function startAuthFlow(callback: (token: string) => void) {
  const port = 5123; // Fixed local port
  
  const server = http.createServer((req, res) => {
    const queryObject = url.parse(req.url || '', true).query;
    
    if (queryObject.token) {
      const token = queryObject.token as string;
      // Persist session across CLI restarts
      fs.writeFileSync(CONFIG_PATH, JSON.stringify({ token }));
      
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Authentication Successful! You can close this tab and return to your terminal.</h1>');
      
      server.close();
      callback(token);
    } else {
      res.writeHead(400);
      res.end('Auth Failure.');
    }
  });

  server.listen(port, () => {
    // Fire up default system browser passing the local port as state payload
    open(`http://localhost:4000/login/github?state=${port}`);
  });
}