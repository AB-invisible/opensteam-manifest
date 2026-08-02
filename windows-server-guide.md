# The Ultimate Native Windows Deployment Guide (No Docker)

Because some VPS providers like Contabo block the virtualization needed for Docker, we will install everything natively on your Windows Server. This guide assumes you have a brand-new Windows Server VPS and walks you through every single click and command.

---

## 🛠️ Step 1: Install the Core Software

Before we download the code, we need to install the programs that run it.

### 1. Install Git (To download the code)
1. Open your web browser on the VPS and go to: [https://git-scm.com/download/win](https://git-scm.com/download/win)
2. Click **64-bit Git for Windows Setup**.
3. Run the downloaded installer. **Keep clicking "Next"** through all the prompts leaving everything default, until you hit "Install".

### 2. Install Node.js (To run the website and bot)
1. Go to: [https://nodejs.org/en/download/prebuilt-installer](https://nodejs.org/en/download/prebuilt-installer)
2. Download the **Windows Installer (.msi) - 64-bit**.
3. Run the installer. 
4. Check the box to accept the license agreement.
5. Keep clicking "Next". Ensure that the "Add to PATH" option is enabled (it is by default).
6. Click "Install" and wait for it to finish.

### 3. Install PostgreSQL (The Database)
1. Go to: [https://www.enterprisedb.com/downloads/postgres-postgresql-downloads](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads)
2. Download the **Windows x86-64** version for PostgreSQL 16 (or latest).
3. Run the installer.
4. **Important**: It will ask you to type a password for the superuser (postgres). **Type a password you will remember** (e.g., `mysecretpassword`). You will need this later!
5. Port: Leave it as `5432`.
6. At the end of the installation, **uncheck** the box that says "Launch Stack Builder at exit" and click Finish.

---

## 📂 Step 2: Download the Application

Now we will download your application code to your Desktop.

1. Click the Windows Start Button, type `PowerShell`, and press Enter.
2. In the blue PowerShell window, navigate to your Desktop:
   ```powershell
   cd C:\Users\Administrator\Desktop
   ```
3. Download the code from your repository:
   ```powershell
   git clone https://github.com/TheMich157/gamegen-manifests.git
   ```
4. Enter the new folder:
   ```powershell
   cd gamegen-manifests
   ```
5. Install the required Node.js libraries by running:
   ```powershell
   npm install
   ```
   *(This will take a minute. It will create a `node_modules` folder.)*

---

## 📝 Step 3: Setup the Configuration File (.env)

Your application needs to know your database password and Discord tokens.

1. Open File Explorer and go to `C:\Users\Administrator\Desktop\gamegen-manifests`.
2. Right-click in the empty space -> **New** -> **Text Document**.
3. Name the file exactly **`.env`** (make sure to delete the `.txt` part at the end).
   - *Tip: If Windows hides file extensions, click the "View" tab at the top of File Explorer and check "File name extensions".*
4. Right-click the `.env` file and select **Open with...** -> **Notepad**.
5. Paste the following text into Notepad:

```env
# --- DATABASE ---
# Connect to your local native PostgreSQL installation
DB_USER=postgres
# CHANGE THIS TO THE PASSWORD YOU SET IN STEP 1:
DB_PASSWORD=your_secure_password_from_step_1
DB_NAME=manifest-generator
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}?schema=public"

# --- STORAGE ---
# Store manifests on your local C:\ drive
BUCKET_TYPE=windows
STORAGE_PATH=C:/bucket

# --- OLLAMA (AI) ---
LOCAL_LLM_BASE_URL=http://localhost:11434/v1

# --- APPLICATION ---
# Put your existing DISCORD_TOKEN, ADMIN_API_KEY, etc here:
```
6. Replace `your_secure_password_from_step_1` with your actual PostgreSQL password.
7. Save the file (`Ctrl + S`) and close Notepad.

---

## 🗄️ Step 4: Setup the Database

We need to create the `manifest-generator` database inside PostgreSQL.

1. Click the Windows Start Button, type **SQL Shell (psql)**, and open it.
2. It will ask for "Server [localhost]:". Just press **Enter** 4 times to accept the defaults (Server, Database, Port, Username).
3. It will ask for the password. Type the password you created in Step 1 (the text will be invisible as you type) and press **Enter**.
4. You should now see `postgres=#`. Type this exact command and press Enter:
   ```sql
   CREATE DATABASE "manifest-generator";
   ```
   *(It should reply with `CREATE DATABASE`)*
5. Type `\q` and press Enter to exit.

6. Now, go back to your **PowerShell** window (which should still be inside the `gamegen-manifests` folder). You have two options:

**Option A: Fresh Database (No existing data)**
If you just want an empty database, push the tables to it by running:
```powershell
npx prisma db push
```
*(If it says "The database needs to be empty", type `y` and press Enter).*

**Option B: Migrating Data from Railway**
If you want to keep all your existing users and data from Railway:
1. Open Command Prompt (on your PC or the server) and create a backup from Railway:
   ```cmd
   pg_dump -U postgres -h [RAILWAY_HOST] -p [RAILWAY_PORT] -d railway -F c -f railway.dump
   ```
   *(You can find the Host, Port, and Password in your Railway Postgres "Variables" tab. It will prompt for the Railway DB password).*
2. Move the `railway.dump` file into your `gamegen-manifests` folder on the Windows Server.
3. In your **PowerShell** window, add PostgreSQL to your session PATH and restore the database:
   ```powershell
   # Add Postgres bin directory to PATH
   $env:Path += ";C:\Program Files\PostgreSQL\18\bin"

   # Run pg_restore
   pg_restore -U postgres -d "manifest-generator" --clean backups/db-backup-latest.dump
   ```
   *(If it prompts for a password, type your local Postgres password from Step 1).*

---

## 🚀 Step 5: Start the App with PM2

We will use **PM2** to run your web server and Discord bot in the background. PM2 will automatically restart them if they crash or if the VPS reboots.

1. In your **PowerShell** window (inside `gamegen-manifests`), install PM2 globally:
   ```powershell
   npm install -g pm2
   ```
2. Build the Next.js website for production:
   ```powershell
   npm run build
   ```
   *(This takes a few minutes).*
3. Start the Web Server and Discord Bot together using the provided PM2 config file:
   ```powershell
   pm2 start ecosystem.config.js
   ```
4. Save the PM2 list so they automatically start when the Windows Server boots up:
   ```powershell
   pm2 save
   ```

**Useful PM2 Commands:**
- `pm2 status` (Shows if they are online)
- `pm2 logs` (Shows live console logs for debugging)
- `pm2 restart all` (Restarts the apps)

---

## 🌐 Step 6: Expose the Website with Cloudflare Tunnel

Right now, the website is only running on `localhost:3000`. We need to route your domain to it using Cloudflare.

1. Go to the [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/) on your own PC.
2. Navigate to **Networks** -> **Tunnels**.
3. Click **Create a tunnel** (Select Cloudflared) and name it.
4. Under "Choose your environment", select **Windows**.
5. Download the `cloudflared.exe` file to your VPS by clicking the 64-bit download link.
6. Move `cloudflared.exe` to your `C:\` drive for easy access (e.g., `C:\cloudflared\cloudflared.exe`).
7. On your VPS, click the Windows Start button, type **PowerShell**, right-click it, and select **Run as Administrator**.
8. Navigate to where you put the file:
   ```powershell
   cd C:\cloudflared
   ```
9. Run the install command provided by Cloudflare:
   ```powershell
   .\cloudflared.exe service install eyJhIjoi...YOUR_LONG_TOKEN_HERE...
   ```
10. Go to the **Public Hostname** tab in Cloudflare:
    - Domain: Choose your domain.
    - Service Type: `HTTP`
    - URL: `localhost:3000`
11. Save it. Your website is now live!

---

## 🧠 Step 7: Install Ollama (AI)

1. Download the Windows installer from [ollama.com/download](https://ollama.com/download) and install it.
2. Open a normal PowerShell window and pull your AI model:
   ```powershell
   ollama pull llama3
   ```
3. Since the bot is running natively on the same machine, it will instantly be able to talk to Ollama without any extra network configuration!
