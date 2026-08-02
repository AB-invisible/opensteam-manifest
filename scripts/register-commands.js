const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 1. Manually load DATABASE_URL from .env (required for Prisma)
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      process.env[key] = value;
    }
  });
}

const prisma = new PrismaClient();
const { GIVEAWAY_COMMAND } = require('./lib/giveaways');
const { ADD_COMMAND, SET_COMMAND } = require('./lib/site-admin-commands');
const { shopCommandChoices } = require('./lib/shop-catalog');

const commands = [
  {
    name: 'admin',
    description: 'Administrative commands for OpenSteam',
    options: [
      {
        name: 'stats',
        description: 'View real-time system health and storage stats',
        type: 1, // SUB_COMMAND
      },
      {
        name: 'user-info',
        description: 'Fetch detailed data about a user',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'user',
            description: 'The User ID or Discord ID',
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: 'set-plan',
        description: "Update a user's subscription plan",
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'user',
            description: 'The User ID or Discord ID',
            type: 3, // STRING
            required: true,
          },
          {
            name: 'plan',
            description: 'The target plan level',
            type: 3, // STRING
            required: true,
            choices: [
              { name: 'Free', value: 'FREE' },
              { name: 'Regular', value: 'REGULAR' },
              { name: 'Premium', value: 'PREMIUM' },
              { name: 'Reseller', value: 'RESELLER' },
              { name: 'Business', value: 'BUSINESS' },
              { name: 'Custom', value: 'CUSTOM' },
            ],
          },
        ],
      },
      {
        name: 'set-role',
        description: "Update a user's OpenSteam platform role (for upload/admin access)",
        type: 1,
        options: [
          {
            name: 'user',
            description: 'Discord @mention or Discord user ID',
            type: 3,
            required: true,
          },
          {
            name: 'role',
            description: 'Platform role to assign',
            type: 3,
            required: true,
            choices: [
              { name: 'User', value: 'USER' },
              { name: 'Trial Moderator', value: 'TRIAL_MODERATOR' },
              { name: 'Moderator', value: 'MODERATOR' },
              { name: 'Senior Moderator', value: 'SENIOR_MODERATOR' },
              { name: 'Head Moderator', value: 'HEAD_MODERATOR' },
              { name: 'Executive Officer', value: 'EXECUTIVE_OFFICER' },
              { name: 'Admin (manifest upload + staff)', value: 'ADMIN' },
              { name: 'Owner', value: 'OWNER' },
            ],
          },
        ],
      },
      {
        name: 'lookup-key',
        description: 'Look up an API key and its owner',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'key',
            description: 'The full API key (e.g. mg_...)',
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: 'create-key',
        description: 'Create an OpenSteam API key for a user (staff override; users pair per device)',
        type: 1,
        options: [
          {
            name: 'user',
            description: 'OpenSteam user ID or Discord ID / mention',
            type: 3,
            required: true,
          },
          {
            name: 'force',
            description: 'Revoke the existing key and issue a new one',
            type: 5, // BOOLEAN
            required: false,
          },
        ],
      },
      {
        name: 'list-keys',
        description: 'List API keys for a user (includes full key values)',
        type: 1,
        options: [
          {
            name: 'user',
            description: 'OpenSteam user ID or Discord ID / mention',
            type: 3,
            required: true,
          },
        ],
      },
      {
        name: 'ban',
        description: 'Ban a user from the platform',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'user',
            description: 'The User ID or Discord ID of the user to ban',
            type: 3, // STRING
            required: true,
          },
          {
            name: 'reason',
            description: 'Reason for the ban',
            type: 3, // STRING
            required: false,
          },
        ],
      },
      {
        name: 'unban',
        description: 'Unban a user on the platform',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'user',
            description: 'The User ID or Discord ID of the user to unban',
            type: 3, // STRING
            required: true,
          },
          {
            name: 'reason',
            description: 'Reason for the unban',
            type: 3, // STRING
            required: false,
          },
        ],
      },
      {
        name: 'softban',
        description: 'Softban (kick and purge messages) a user from the Discord server',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'user',
            description: 'The Discord User ID or Mention of the user to softban',
            type: 3, // STRING
            required: true,
          },
          {
            name: 'reason',
            description: 'Reason for the softban',
            type: 3, // STRING
            required: false,
          },
        ],
      },
      {
        name: 'kick',
        description: 'Kick a user from the Discord server',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'user',
            description: 'The Discord User ID or Mention of the user to kick',
            type: 3, // STRING
            required: true,
          },
          {
            name: 'reason',
            description: 'Reason for the kick',
            type: 3, // STRING
            required: false,
          },
        ],
      },
      {
        name: 'manifest',
        description: 'Check if a game manifest exists in the database',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'appid',
            description: 'The Steam App ID to check',
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: 'lookup-ip',
        description: 'Check security logs and risk score for an IP address',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'ip',
            description: 'The IPv4 or IPv6 address to investigate',
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: 'pullback',
        description: 'Force-join authorized users back into the Discord server',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'user',
            description: 'Optional OpenSteam user ID or Discord ID (omit for all users)',
            type: 3, // STRING
            required: false,
          },
        ],
      },
      {
        name: 'merge',
        description: 'Detect users with role 1493956344925917184 and assign 1473719437692637288 if only role',
        type: 1, // SUB_COMMAND
      },
      {
        name: 'site-set',
        description: 'Update OpenSteam website branding (name, URL, colors, footer)',
        type: 1,
        options: [
          {
            name: 'setting',
            description: 'Which setting to change',
            type: 3,
            required: true,
            choices: [
              { name: 'Site name', value: 'siteName' },
              { name: 'Site URL (opensteam.lol)', value: 'siteUrl' },
              { name: 'Login URL (OAuth /gen link)', value: 'loginUrl' },
              { name: 'Tagline', value: 'tagline' },
              { name: 'Hero title', value: 'heroTitle' },
              { name: 'Hero subtitle', value: 'heroSubtitle' },
              { name: 'Desktop app title', value: 'desktopAppTitle' },
              { name: 'Accent color (hex)', value: 'accentColor' },
              { name: 'Secondary color (hex)', value: 'secondaryColor' },
              { name: 'Logo path', value: 'logoPath' },
              { name: 'Discord invite', value: 'discordInvite' },
              { name: 'Telegram link', value: 'telegramLink' },
              { name: 'Footer text', value: 'footerText' },
            ],
          },
          {
            name: 'value',
            description: 'New value',
            type: 3,
            required: true,
          },
        ],
      },
      {
        name: 'site-get',
        description: 'Show current OpenSteam website branding settings',
        type: 1,
      },
    ],
  },
  {
    name: 'key',
    description: 'Get your OpenSteam desktop app API key (one per device)',
    options: [
      {
        name: 'pair',
        description: 'Link OpenSteam App using the pairing code from Settings',
        type: 1,
        options: [
          {
            name: 'code',
            description: '8-character code from OpenSteam App',
            type: 3,
            required: true,
          },
        ],
      },
      {
        name: 'status',
        description: 'Show your device-bound API keys',
        type: 1,
      },
      {
        name: 'show',
        description: 'Send your OpenSteam API keys to your DMs (one per device)',
        type: 1,
      },
    ],
  },
  {
    name: 'gen',
    description: 'Generate a manifest for a Steam App ID',
    options: [
      {
        name: 'appid',
        description: 'Numeric Steam App ID (e.g. 730)',
        type: 4, // INTEGER
        required: true,
        min_value: 1,
      },
    ],
  },
  {
    name: 'ask',
    description: 'Ask Atis, the OpenSteam AI Knowledge Base Assistant',
    options: [
      {
        name: 'query',
        description: 'Your question about manifests (.lua), verification, API keys, or platform rules',
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: 'dlcgen',
    description: 'Generate DLC Lua for a Steam App ID',
    options: [
      {
        name: 'appid',
        description: 'Numeric Steam App ID (e.g. 730)',
        type: 4, // INTEGER
        required: true,
        min_value: 1,
      },
    ],
  },
  {
    name: 'autogen',
    description: 'Generate requested or missing games from upstream providers into the database',
    options: [
      {
        name: 'action',
        description: 'Run now, enable a daily mode, disable daily jobs, or show status',
        type: 3, // STRING
        required: false,
        choices: [
          { name: 'Run now', value: 'run' },
          { name: 'Enable request queue daily', value: 'enable' },
          { name: 'Enable DepotBox 120/day mode', value: 'enable_depotbox' },
          { name: 'Enable Ryuu/Morrenus scan mode', value: 'enable_upstream' },
          { name: 'Enable Heavygen daemon mode', value: 'enable_heavygen' },
          { name: 'Disable daily', value: 'disable' },
          { name: 'Status', value: 'status' },
        ],
      },
      {
        name: 'limit',
        description: 'How many items to process (request mode max 25, upstream/DepotBox max 100–120)',
        type: 4, // INTEGER
        required: false,
        min_value: 1,
        max_value: 120,
      },
      {
        name: 'request_id',
        description: 'Optional specific OpenSteam request ID to process',
        type: 3, // STRING
        required: false,
      },
    ],
  },
  {
    name: 'status',
    description: 'Check your current account status and daily usage'
  },
  {
    name: 'request',
    description: 'Request a new game manifest to be added to OpenSteam',
    options: [
      {
        name: 'appid',
        description: 'The Steam App ID of the game',
        type: 3, // STRING
        required: true
      },
      {
        name: 'comment',
        description: 'Optional comment/reason for the request',
        type: 3, // STRING
        required: false
      }
    ]
  },
  {
    name: 'dm-warn',
    description: 'DM a user a warning about something not permitted within OpenSteam',
    default_member_permissions: '8', // ADMINISTRATOR permission flag
    options: [
      {
        name: 'user',
        description: 'The user to warn via DM',
        type: 6, // USER
        required: true,
      },
      {
        name: 'reason',
        description: 'What the user did that is not permitted within OpenSteam',
        type: 3, // STRING
        required: true,
      }
    ]
  },
  {
    name: 'self-adv',
    description: 'DM a specific message to all users',
    options: [
      {
        name: 'message',
        description: 'The message to send',
        type: 3,
        required: true
      }
    ]
  },
  {
    name: 'drop',
    description: 'Drop accounts from a platform pool in drops/ (Administrator only)',
    default_member_permissions: '8', // ADMINISTRATOR permission flag
    options: [
      {
        name: 'count',
        description: 'How many accounts to drop (1–25)',
        type: 4, // INTEGER
        required: true,
        min_value: 1,
        max_value: 25,
      },
      {
        name: 'platform',
        description: 'Platform pool (drops/steam.txt, netflix.txt, etc.)',
        type: 3, // STRING
        required: true,
        autocomplete: true,
      },
      {
        name: 'min_games',
        description: 'Minimum games required on the account (Steam pools)',
        type: 4, // INTEGER
        required: false,
        min_value: 0,
      }
    ]
  },
  {
    name: 'coins',
    description: 'Check your current coin balance or check another user balance',
    options: [
      {
        name: 'user',
        description: 'The user to check balance for',
        type: 6, // USER
        required: false
      }
    ]
  },
  {
    name: 'daily',
    description: 'Claim your daily free coins (100–300 coins)'
  },
  {
    name: 'shop',
    description: 'View the OpenSteam Sentinel Cosmetic Perk Shop'
  },
  {
    name: 'buy',
    description: 'Purchase a cosmetic or fun perk from the shop using your coins',
    options: [
      {
        name: 'item',
        description: 'The item to purchase',
        type: 3, // STRING
        required: true,
        choices: shopCommandChoices()
      },
      {
        name: 'value',
        description: 'Text value for the selected perk, when required',
        type: 3, // STRING
        required: false
      },
      {
        name: 'target',
        description: 'Target user for target-based perks',
        type: 6, // USER
        required: false
      }
    ]
  },
  {
    name: 'work',
    description: 'Work a random job for coins (1 Hour Cooldown)'
  },
  {
    name: 'weekly',
    description: 'Claim your massive weekly coin bonus!'
  },
  {
    name: 'rob',
    description: 'Attempt to steal coins from another user (High Risk!)',
    options: [
      {
        name: 'user',
        description: 'The user you want to rob',
        type: 6, // USER
        required: true
      }
    ]
  },
  {
    name: 'highlow',
    description: 'Bet on whether the next number (1-100) will be higher or lower',
    options: [
      {
        name: 'bet',
        description: 'Amount of coins to bet',
        type: 4, // INTEGER
        required: true,
        min_value: 10
      }
    ]
  },
  {
    name: '8ball',
    description: 'Ask the Magic 8-Ball a question and receive its wisdom',
    options: [
      {
        name: 'question',
        description: 'The question to ask the Magic 8-Ball',
        type: 3, // STRING
        required: true
      }
    ]
  },
  {
    name: 'coinflip',
    description: 'Flip a coin - Heads or Tails'
  },
  {
    name: 'gamble',
    description: 'Bet a certain amount of coins on a dice roll (Double or Nothing!)',
    options: [
      {
        name: 'amount',
        description: 'The amount of coins to gamble',
        type: 4, // INTEGER
        required: true,
        min_value: 1
      }
    ]
  },
  {
    name: 'slots',
    description: 'Spin the OpenSteam Slots for a chance to multiply your coins',
    options: [
      {
        name: 'amount',
        description: 'The amount of coins to bet',
        type: 4, // INTEGER
        required: true,
        min_value: 1
      }
    ]
  },
  {
    name: 'leaderboard',
    description: 'Show the richest users on OpenSteam economy'
  },
  {
    name: 'pay',
    description: 'Transfer some of your coins to another user',
    options: [
      {
        name: 'user',
        description: 'The user to pay coins to',
        type: 6, // USER
        required: true
      },
      {
        name: 'amount',
        description: 'The amount of coins to pay',
        type: 4, // INTEGER
        required: true,
        min_value: 1
      }
    ]
  },
  {
    name: 'rps',
    description: 'Play Rock-Paper-Scissors against the bot with optional coin wager',
    options: [
      {
        name: 'choice',
        description: 'Your move: rock, paper, or scissors',
        type: 3, // STRING
        required: true,
        choices: [
          { name: 'Rock 🪨', value: 'rock' },
          { name: 'Paper 📄', value: 'paper' },
          { name: 'Scissors ✂️', value: 'scissors' }
        ]
      },
      {
        name: 'wager',
        description: 'Coins to bet (optional)',
        type: 4, // INTEGER
        required: false,
        min_value: 1
      }
    ]
  },
  {
    name: 'trivia',
    description: 'Answer a OpenSteam trivia question to win free coins!'
  },
  {
    name: 'promote',
    description: 'Promote a member by one role higher in the hierarchy, or directly to a target role.',
    default_member_permissions: '8',
    options: [
      {
        name: 'user',
        description: 'The member to promote',
        type: 6,
        required: true
      },
      {
        name: 'role',
        description: 'Target role to promote directly to',
        type: 8,
        required: false
      }
    ]
  },
  {
    name: 'demote',
    description: 'Demote a member by one role lower in the hierarchy, or directly from a target role.',
    default_member_permissions: '8',
    options: [
      {
        name: 'user',
        description: 'The member to demote',
        type: 6,
        required: true
      },
      {
        name: 'role',
        description: 'Target role to demote directly from',
        type: 8,
        required: false
      }
    ]
  },
  {
    name: 'warn',
    description: 'Formally warn a member, log it in the database audit log, and DM them the warning.',
    default_member_permissions: '8',
    options: [
      {
        name: 'user',
        description: 'The member to warn',
        type: 6,
        required: true
      },
      {
        name: 'reason',
        description: 'The reason for the warning',
        type: 3,
        required: true
      },
      {
        name: 'proof',
        description: 'Image/screenshot proof of the infraction',
        type: 11,
        required: false
      }
    ]
  },
  {
    name: 'timeout',
    description: 'Time out / mute a member in the guild for a specified duration.',
    default_member_permissions: '8',
    options: [
      {
        name: 'user',
        description: 'The member to timeout',
        type: 6,
        required: true
      },
      {
        name: 'duration',
        description: 'Duration (e.g. 60s, 5m, 1h, 1d, 7d)',
        type: 3,
        required: true
      },
      {
        name: 'reason',
        description: 'Reason for the timeout',
        type: 3,
        required: false
      },
      {
        name: 'proof',
        description: 'Image/screenshot proof of the infraction',
        type: 11,
        required: false
      }
    ]
  },
  {
    name: 'modlogs',
    description: "View a member's moderation infractions and action history.",
    default_member_permissions: '8',
    options: [
      {
        name: 'user',
        description: 'The user to check modlogs for',
        type: 6,
        required: true
      }
    ]
  },
  {
    name: 'grantrole',
    description: 'Grant a role to every member who has another role',
    default_member_permissions: '8',
    options: [
      {
        name: 'has_role',
        description: 'Members must have this role (e.g. unverified)',
        type: 8,
        required: true,
      },
      {
        name: 'grant_role',
        description: 'Role to add to those members (e.g. verified)',
        type: 8,
        required: true,
      },
    ],
  },
  {
    name: 'telegram',
    description: 'Get the official OpenSteam Telegram Channel invite link',
  },
  {
    name: 'onlinefix',
    description: 'Fetch OnlineFix data by game name',
    options: [
      {
        name: 'name',
        description: 'Game name to search for',
        type: 3, // STRING
        required: true,
        autocomplete: true
      }
    ]
  },
  {
    name: 'Report Message',
    type: 3
  },
  GIVEAWAY_COMMAND,
  ADD_COMMAND,
  SET_COMMAND,
];

async function registerCommands() {
  try {
    console.log('Connecting to database to fetch Discord credentials...');
    
    const [tokenConfig, clientConfig, secretConfig, guildConfig] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { key: 'DISCORD_BOT_TOKEN' } }),
      prisma.systemConfig.findUnique({ where: { key: 'DISCORD_CLIENT_ID' } }),
      prisma.systemConfig.findUnique({ where: { key: 'DISCORD_CLIENT_SECRET' } }),
      prisma.systemConfig.findUnique({ where: { key: 'DISCORD_GUILD_ID' } })
    ]);

    const DISCORD_BOT_TOKEN = tokenConfig?.value;
    const DISCORD_CLIENT_ID = clientConfig?.value;
    const DISCORD_GUILD_ID = guildConfig?.value;

    if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
      console.error('Error: DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID not found in Admin Settings (SystemConfig table).');
      console.log('Please add them via the Admin Dashboard > Settings tab first.');
      await prisma.$disconnect();
      process.exit(1);
    }

    if (!DISCORD_GUILD_ID) {
      console.error('Error: DISCORD_GUILD_ID not found in Admin Settings. Cannot register guild commands.');
      await prisma.$disconnect();
      process.exit(1);
    }

    const headers = {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    };

    // Step 1: Wipe all global commands to eliminate duplicates in Discord
    console.log('Clearing all global slash commands to prevent duplicates...');
    await axios.put(
      `https://discord.com/api/v10/applications/${DISCORD_CLIENT_ID}/commands`,
      [],
      { headers }
    );
    console.log('✅ Global commands cleared.');

    // Step 2: Register all commands guild-specifically (instant, no 1-hour delay)
    console.log(`Registering guild slash commands instantly for guild: ${DISCORD_GUILD_ID}...`);
    const guildResponse = await axios.put(
      `https://discord.com/api/v10/applications/${DISCORD_CLIENT_ID}/guilds/${DISCORD_GUILD_ID}/commands`,
      commands,
      { headers }
    );
    console.log('✅ Successfully registered guild commands:', guildResponse.data.map(c => c.name));

  } catch (error) {
    if (error.response) {
      console.error('Discord API Error:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  commands,
  registerCommands,
};

if (require.main === module) {
  registerCommands();
}
