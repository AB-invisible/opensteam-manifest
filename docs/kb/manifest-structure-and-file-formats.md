# Manifest Structure & File Formats Guide

This article explains the structure of generated OpenSteam packages, file extensions, and activation scripts.

## Core File Types: `.lua` vs `.manifest`

### 1. Main Script File (`.lua`)
- **Primary execution file**: The **`.lua`** file (e.g. `main.lua` or game-specific Lua scripts) is the **primary manifest script file**.
- **Contains app definitions**: Defines Steam App IDs, depot keys, launch configurations, DLC entries, and game metadata.
- **Required**: The `.lua` script file is **always required** for Steam game activation and manifest generation on OpenSteam.

### 2. Depot Manifest Files (`.manifest`)
- **Optional depot metadata**: `.manifest` files store specific binary chunk manifest data for individual Steam depots.
- **NOT always required**: **`.manifest` files are NOT always required.** Many games, scripts, and depot configurations operate entirely via `.lua` script files without needing separate `.manifest` files.
- If a generated manifest ZIP contains only `.lua` files without `.manifest` files, **the package is complete and fully functional**.

## What is inside a OpenSteam Manifest Package?

When you generate or download a game manifest (via web, `/gen` in Discord, or API):

```
📦 Manifest-Package.zip
 ├── 📄 main.lua (Main Lua script — REQUIRED)
 ├── 📄 depot_XXXX.manifest (Optional depot metadata file — NOT always required)
 └── 📄 config.lua / extra Lua scripts (Optional helper configs)
```

## How Activation Works

1. **Lua Script Ingestion**: Steam client tools or activation managers read the `.lua` file to register game ownership and depot parameters.
2. **Depot Fetching**: If specific binary depot chunks are needed, tools inspect `.manifest` files if present; otherwise, standard depot streaming from Steam or CDN is used.
3. **Common Misconceptions**:
   - ❌ *Misconception*: "I didn't receive a `.manifest` file, so the generation failed."
   - ✅ *Fact*: The **`.lua` file is the main file**. `.manifest` files are optional and not required for all games.

## Summary Table

| File Extension | Role | Is it required? |
|---|---|---|
| **`.lua`** | Main manifest script, app & depot logic | **YES — Always Required** |
| **`.manifest`** | Binary depot chunk metadata | **NO — Optional / Not Always Required** |
