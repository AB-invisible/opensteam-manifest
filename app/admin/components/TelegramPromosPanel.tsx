'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Trash2, Edit2, Check, X, Send, Image as ImageIcon, Zap, Clock, AlertTriangle, Settings, ChevronDown, ChevronUp } from 'lucide-react'

interface Promo {
  id: string
  text: string
  photo: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface EnvStatus {
  hasBotToken: boolean
  hasChannelId: boolean
  hasAdminGroupId: boolean
}

// --- Pre-built Promo Templates ---
const PROMO_TEMPLATES = [
  {
    label: '🎮 Daily Game Drop',
    text: `🎮 <b>DAILY GAME DROP IS LIVE!</b>\n\n🚀 Get the freshest Steam manifests every single day on OpenSteam — your go-to platform for instant, reliable downloads!\n\n✅ Instant downloads — no waiting\n✅ 100% free for everyone\n✅ Full Steam manifest compatibility\n✅ New games added around the clock\n\n👉 Visit: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🔥 New Manifests Alert',
    text: `🔥 <b>NEW MANIFESTS JUST DROPPED!</b>\n\nOur library just got even bigger! Browse thousands of fresh Steam manifests and grab your favorites completely free!\n\n🕹️ 5000+ games available\n⚡ Lightning-fast generation\n🔒 Trusted by 50,000+ users\n🌟 Daily updates you won't find anywhere else\n\n👉 Start browsing: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🌐 Join Our Community',
    text: `🌐 <b>JOIN THE GROWING OPENSTEAM FAMILY!</b>\n\nThousands of gamers already use OpenSteam — the most reliable Steam manifest platform in the scene!\n\n🤖 Discord bot for instant commands\n📱 24/7 Telegram support\n🎯 No technical skills needed — it just works\n\n👉 Join us: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '⚡ Quick Reminder',
    text: `⚡ <b>QUICK REMINDER!</b>\n\nHey gamer! You haven't visited OpenSteam in a while — you're missing out on all the latest drops and updates!\n\nWe add new manifests 24/7 so your library stays fresh. Don't sleep on it! 🔥\n\n👉 Check it out: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1493711662062-fa541f7f76ec?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🏆 Discord Invite',
    text: `🏆 <b>JOIN OUR DISCORD SERVER NOW!</b>\n\nWant instant support? Live updates? Giveaways? We've got you covered in our active Discord community!\n\n💬 10,000+ members and counting\n🛡️ Staff on duty 24/7\n🎉 Weekly giveaways & events\n🎁 Exclusive perks for active users\n\n👉 Come hang out: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🎁 Weekend Special',
    text: `🎁 <b>WEEKEND SPECIAL!</b>\n\nOpenSteam is your ticket to an epic weekend of gaming! Browse all your favorite titles and grab their manifests for free!\n\n🎮 New drops added daily\n⚡ No credit card needed\n🌟 The most reliable platform around\n\n👉 Let's game: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🎯 Why Choose OpenSteam',
    text: `🎯 <b>WHY CHOOSE OPENSTEAM?</b>\n\nWe're not just another platform — we're the best at what we do!\n\n✅ 50,000+ happy users\n✅ 100% free service\n✅ Lightning-fast downloads\n✅ 24/7 updates\n\n👉 See for yourself: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🚀 Get Started Now',
    text: `🚀 <b>GET STARTED NOW!</b>\n\nReady to start generating Steam manifests instantly? It's super easy!\n\n1. Go to opensteam.lol\n2. Sign in with Discord\n3. Search & generate — done!\n\n👉 Your next game is waiting: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1612287230202-1ff1d85d1bdf?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '👾 Gamers Paradise',
    text: `👾 <b>WELCOME TO GAMER'S PARADISE!</b>\n\nOpenSteam has all your favorite Steam games with instant manifest downloads!\n\n🎮 Action, RPG, indie, and more\n⚡ No delays, no wait times\n🎯 The most trusted platform\n\n👉 Explore now: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1593305841991-05c297ba4575?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🌟 User Favorite',
    text: `🌟 <b>GAMERS LOVE OPENSTEAM!</b>\n\nJoin thousands of happy users who trust OpenSteam for all their Steam manifest needs!\n\n💯 5-star reviews\n⚡ Fastest downloads\n🎮 Most games available\n\n👉 See what all the hype is about: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '💎 Premium Experience',
    text: `💎 <b>FREE PREMIUM EXPERIENCE!</b>\n\nGet all the perks without paying a cent! OpenSteam offers premium features for everyone!\n\n✅ No subscriptions\n✅ No hidden fees\n✅ All features unlocked\n\n👉 Start enjoying: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🎲 Game Night Ready',
    text: `🎲 <b>GAME NIGHT READY!</b>\n\nPlanning a game night? OpenSteam has all the manifests you need for an unforgettable evening!\n\n🎮 Co-op games\n🎯 Competitive titles\n🌟 Party favorites\n\n👉 Get ready: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1556438064-2d7646166530?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '⚔️ Action Games',
    text: `⚔️ <b>ACTION PACKED ADVENTURES!</b>\n\nLove fast-paced action? We've got tons of action game manifests ready to download!\n\n💥 Shooters\n🗡️ Hack & slash\n🏃‍♂️ Platformers\n\n👉 Dive in: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🧙‍♂️ RPG Heaven',
    text: `🧙‍♂️ <b>RPG HEAVEN!</b>\n\nEmbark on epic quests with our massive collection of RPG manifests!\n\n⚔️ Fantasy worlds\n🚀 Sci-fi adventures\n🌟 Character-driven stories\n\n👉 Start your journey: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🎨 Indie Gems',
    text: `🎨 <b>INDIE GEMS GALORE!</b>\n\nDiscover amazing indie games you might have missed! We've got all the best indie manifests!\n\n💡 Unique gameplay\n🎭 Beautiful art\n❤️ Made with passion\n\n👉 Explore indies: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🏎️ Racing Games',
    text: `🏎️ <b>NEED FOR SPEED?</b>\n\nGet your adrenaline fix with our awesome collection of racing game manifests!\n\n🏁 Street racing\n🏎️ Formula 1\n🚗 Off-road adventures\n\n👉 Hit the gas: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1485291523064-84287099e286?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '⚽ Sports Games',
    text: `⚽ <b>SPORTS FANATICS UNITE!</b>\n\nWhether you love soccer, basketball, or any other sport — we've got the manifests you need!\n\n🏀 Basketball\n⚽ Soccer\n🏈 Football\n\n👉 Score big: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1461896836934-ffe607ba821?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🧠 Strategy Games',
    text: `🧠 <b>STRATEGY MASTERS!</b>\n\nTest your tactical skills with our incredible collection of strategy game manifests!\n\n🏰 Turn-based\n⚔️ Real-time strategy\n🌍 Grand strategy\n\n👉 Outsmart opponents: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🏗️ Simulation Games',
    text: `🏗️ <b>SIMULATION AWESOMENESS!</b>\n\nBuild, manage, and create with our amazing simulation game manifests!\n\n🏙️ City builders\n🌾 Farm sims\n✈️ Flight sims\n\n👉 Start building: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '👻 Horror Games',
    text: `👻 <b>DARE TO BE SCARED?</b>\n\nFor the brave gamers, we've got a huge collection of horror game manifests!\n\n🏚️ Survival horror\n👹 Psychological horror\n🧟 Zombie games\n\n👉 Enter the darkness: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🎭 Story-Driven Games',
    text: `🎭 <b>UNFORGETTABLE STORIES!</b>\n\nExperience emotional, gripping narratives with our story-driven game manifests!\n\n📖 Amazing writing\n🎬 Cinematic moments\n❤️ Memorable characters\n\n👉 Start the story: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🎪 Co-op Fun',
    text: `🎪 <b>CO-OP MADNESS!</b>\n\nGrab your friends and enjoy amazing co-op experiences with our co-op game manifests!\n\n👥 Team up with friends\n🎮 Shared adventures\n🎉 Laughs & memories\n\n👉 Play together: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🎮 Retro Classics',
    text: `🎮 <b>RETRO CLASSICS!</b>\n\nRelive the golden age of gaming with our collection of retro-inspired game manifests!\n\n🕹️ Pixel art\n🎵 Chiptune soundtracks\n❤️ Nostalgia overload\n\n👉 Go retro: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🚀 Sci-Fi Games',
    text: `🚀 <b>TO THE STARS!</b>\n\nExplore distant galaxies and futuristic worlds with our sci-fi game manifests!\n\n🌌 Space exploration\n🤖 Future tech\n👽 Alien encounters\n\n👉 Blast off: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🧜 Fantasy Worlds',
    text: `🧜 <b>FANTASY AWAITS!</b>\n\nStep into magical realms with our fantasy game manifests!\n\n🐉 Dragons & magic\n🏰 Epic quests\n🧙‍♂️ Wizards & warriors\n\n👉 Enter the fantasy: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🏝️ Open World Games',
    text: `🏝️ <b>EXPLORE ENDLESS WORLDS!</b>\n\nGet lost in massive open worlds with our open-world game manifests!\n\n🗺️ Huge maps\n🏃‍♂️ Freedom to explore\n🌟 Hidden secrets\n\n👉 Start exploring: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🎯 Competitive Gaming',
    text: `🎯 <b>CLIMB THE RANKS!</b>\n\nFor the competitive gamers, we've got all the best multiplayer manifests!\n\n🏆 Ranked matches\n⚔️ Esports titles\n💪 Pro-level gameplay\n\n👉 Show your skills: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🎁 Daily Reminder',
    text: `🎁 <b>DON'T FORGET!</b>\n\nOpenSteam is here every single day with fresh new manifests for you to enjoy!\n\n✅ New games daily\n✅ Always free\n✅ Always reliable\n\n👉 Visit today: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1493711662062-fa541f7f76ec?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '💬 Community Spotlight',
    text: `💬 <b>OUR AMAZING COMMUNITY!</b>\n\nOpenSteam wouldn't be what it is without our awesome community of gamers!\n\n👋 Join the family\n💡 Share your ideas\n🎉 Events & giveaways\n\n👉 Join us: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🏆 Best Platform',
    text: `🏆 <b>THE BEST PLATFORM!</b>\n\nDon't settle for less — OpenSteam is the #1 choice for Steam manifest downloads!\n\n🏅 #1 in reliability\n⚡ #1 in speed\n🎮 #1 in selection\n\n👉 Join the best: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🔄 Always Updating',
    text: `🔄 <b>ALWAYS FRESH!</b>\n\nOur library is always growing with new game manifests added constantly!\n\n📅 Daily additions\n🔄 Updated versions\n🌟 Trending games\n\n👉 Stay fresh: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🎮 Game Collection',
    text: `🎮 <b>BUILD YOUR COLLECTION!</b>\n\nWith OpenSteam, you can build an epic game library without spending a dime!\n\n📚 Thousands of games\n✅ All free\n⚡ Instant access\n\n👉 Start collecting: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1461896836934-ffe607ba821?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '⏰ Limited Time',
    text: `⏰ <b>DON'T MISS OUT!</b>\n\nNow's the perfect time to check out OpenSteam — your next favorite game is waiting!\n\n🎮 New drops happening\n⚡ Everything is free\n🌟 Now or never\n\n👉 Go now: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1485291523064-84287099e286?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🎊 Celebration',
    text: `🎊 <b>CELEBRATE WITH US!</b>\n\nWe're celebrating our growing community — come join the party on OpenSteam!\n\n🎉 Thank you, gamers!\n🎮 More games than ever\n🌟 The party never stops\n\n👉 Celebrate with us: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🎨 Creative Games',
    text: `🎨 <b>UNLEASH YOUR CREATIVITY!</b>\n\nExpress yourself with our amazing collection of creative game manifests!\n\n✏️ Sandbox games\n🎮 Level editors\n🎨 Creative modes\n\n👉 Create something amazing: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '💥 Explosive Action',
    text: `💥 <b>EXPLOSIVE ACTION!</b>\n\nGet your heart pumping with high-octane action game manifests!\n\n🎯 Non-stop thrills\n💣 Big explosions\n🏃‍♂️ Fast-paced gameplay\n\n👉 Get your fix: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🎵 Soundtracks',
    text: `🎵 <b>AMAZING SOUNDTRACKS!</b>\n\nOur games don't just look good — they sound incredible too!\n\n🎶 Epic scores\n🎵 Memorable tunes\n🎧 Immersive audio\n\n👉 Hear the difference: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1459749411179-9636197389c4?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🏖️ Summer Gaming',
    text: `🏖️ <b>SUMMER GAMING MARATHON!</b>\n\nMake this summer unforgettable with endless gaming from OpenSteam!\n\n☀️ No school, all games\n🏖️ Relax & play\n🎮 Non-stop fun\n\n👉 Summer mode: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '❄️ Winter Gaming',
    text: `❄️ <b>COZY WINTER GAMING!</b>\n\nBundle up and enjoy amazing games all winter long with OpenSteam!\n\n☕ Hot cocoa & games\n❄️ Snow days = game days\n🎮 Cozy vibes\n\n👉 Get cozy: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1482192597420-481f99372e39?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🍂 Fall Gaming',
    text: `🍂 <b>FALL INTO GAMING!</b>\n\nCrisp air, cozy sweaters, and amazing games — fall gaming season is here!\n\n🍁 Cozy vibes\n🎮 Epic adventures\n☕ Warm drinks\n\n👉 Fall in love: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1476820865390-c52aeebb9891?auto=format&fit=crop&w=1200&q=80',
  },
  {
    label: '🌸 Spring Gaming',
    text: `🌸 <b>SPRING INTO ACTION!</b>\n\nNew season, new games! Explore fresh adventures this spring on OpenSteam!\n\n🌸 Fresh starts\n🎮 New releases\n🌱 Growth & fun\n\n👉 Spring forward: <a href="http://127.0.0.1:3000">opensteam.lol</a>`,
    photo: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=1200&q=80',
  },
]

export function TelegramPromosPanel() {
  const [promos, setPromos] = useState<Promo[]>([])
  const [loading, setLoading] = useState(true)
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Form State
  const [isEditing, setIsEditing] = useState<string | null>(null)
  const [formText, setFormText] = useState('')
  const [formPhoto, setFormPhoto] = useState('')
  const [formIsActive, setFormIsActive] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [sendingNow, setSendingNow] = useState<string | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)

  // Silent background refresh
  const fetchPromos = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [promosRes, envRes] = await Promise.all([
        fetch('/api/admin/telegram-promos'),
        fetch('/api/admin/telegram-promos/env-status'),
      ])
      if (!promosRes.ok) throw new Error('Failed to fetch promos')
      const data = await promosRes.json()
      setPromos(data)
      if (envRes.ok) {
        const envData = await envRes.json()
        setEnvStatus(envData)
      }
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  // Initial load + background polling every 30s (silent)
  useEffect(() => {
    fetchPromos(false)
    const interval = setInterval(() => fetchPromos(true), 30000)
    return () => clearInterval(interval)
  }, [fetchPromos])

  const handleSave = async () => {
    if (!formText.trim()) return
    const id = isEditing && isEditing !== 'new' ? isEditing : 'new'
    setSavingId(id)
    try {
      const method = id !== 'new' ? 'PATCH' : 'POST'
      const body = JSON.stringify({
        id: id !== 'new' ? id : undefined,
        text: formText,
        photo: formPhoto || null,
        isActive: formIsActive,
      })
      const res = await fetch('/api/admin/telegram-promos', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (!res.ok) throw new Error('Failed to save promo')
      await fetchPromos(true)
      setIsEditing(null)
      setFormText('')
      setFormPhoto('')
      setFormIsActive(true)
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSavingId(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this promo?')) return
    setSavingId(id)
    try {
      const res = await fetch(`/api/admin/telegram-promos?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete promo')
      await fetchPromos(true)
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSavingId(null)
    }
  }

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    setSavingId(id)
    try {
      const res = await fetch('/api/admin/telegram-promos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isActive: !currentActive }),
      })
      if (!res.ok) throw new Error('Failed to toggle status')
      // Optimistic update
      setPromos(prev => prev.map(p => p.id === id ? { ...p, isActive: !p.isActive } : p))
    } catch (err: any) {
      alert(err.message)
      await fetchPromos(true)
    } finally {
      setSavingId(null)
    }
  }

  const handleSendNow = async (promoId: string) => {
    setSendingNow(promoId)
    try {
      const res = await fetch('/api/admin/telegram-promos/send-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: promoId }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to send')
      alert('✅ Promo sent to channel successfully!')
    } catch (err: any) {
      alert(`❌ ${err.message}`)
    } finally {
      setSendingNow(null)
    }
  }

  const startEdit = (promo?: Promo) => {
    if (promo) {
      setIsEditing(promo.id)
      setFormText(promo.text)
      setFormPhoto(promo.photo || '')
      setFormIsActive(promo.isActive)
    } else {
      setIsEditing('new')
      setFormText('')
      setFormPhoto('')
      setFormIsActive(true)
    }
    setShowTemplates(false)
  }

  const cancelEdit = () => {
    setIsEditing(null)
    setFormText('')
    setFormPhoto('')
    setFormIsActive(true)
    setShowTemplates(false)
  }

  const applyTemplate = (template: typeof PROMO_TEMPLATES[0]) => {
    setFormText(template.text)
    setFormPhoto(template.photo || '')
    setShowTemplates(false)
  }

  const missingEnv = envStatus && (!envStatus.hasBotToken || !envStatus.hasChannelId)

  if (loading && promos.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="space-y-3 text-center">
          <Send className="h-8 w-8 text-indigo-400 animate-pulse mx-auto" />
          <p className="text-white/40 text-sm font-bold uppercase tracking-widest">Loading Promos...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-sky-500/20 rounded-2xl border border-sky-500/30">
            <Send className="h-6 w-6 text-sky-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight">Telegram Promos</h2>
            <p className="text-sm text-white/40 mt-0.5">Manage automated daily messages sent to your Telegram channel.</p>
          </div>
        </div>
        <button
          onClick={() => startEdit()}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold flex items-center space-x-2 transition-all active:scale-95 shadow-lg shadow-indigo-500/20"
        >
          <Plus className="h-4 w-4" />
          <span>New Promo</span>
        </button>
      </div>

      {/* Env Status Banner */}
      {envStatus && (
        <div className={`rounded-2xl p-4 border flex flex-col sm:flex-row sm:items-center gap-3 ${missingEnv ? 'bg-amber-500/10 border-amber-500/20' : 'bg-emerald-500/10 border-emerald-500/20'}`}>
          <AlertTriangle className={`h-5 w-5 flex-shrink-0 ${missingEnv ? 'text-amber-400' : 'text-emerald-400'}`} />
          <div className="flex-1 text-sm">
            {missingEnv ? (
              <p className="text-amber-300 font-bold">
                ⚠️ Promos won't be sent! Missing environment variables:
                {!envStatus.hasBotToken && <span className="ml-2 px-2 py-0.5 bg-amber-500/20 rounded font-mono text-xs">TELEGRAM_BOT_TOKEN</span>}
                {!envStatus.hasChannelId && <span className="ml-2 px-2 py-0.5 bg-amber-500/20 rounded font-mono text-xs">TELEGRAM_PUBLIC_CHANNEL_ID</span>}
              </p>
            ) : (
              <p className="text-emerald-300 font-bold">✅ Telegram bot connected and channel configured — promos will be sent daily.</p>
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest">
            <span className={`flex items-center gap-1 ${envStatus.hasBotToken ? 'text-emerald-400' : 'text-red-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${envStatus.hasBotToken ? 'bg-emerald-400' : 'bg-red-400'}`} />
              BOT TOKEN
            </span>
            <span className={`flex items-center gap-1 ${envStatus.hasChannelId ? 'text-emerald-400' : 'text-red-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${envStatus.hasChannelId ? 'bg-emerald-400' : 'bg-red-400'}`} />
              CHANNEL ID
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Create/Edit Form */}
      {isEditing && (
        <div className="p-6 bg-[#0A0A0C] border border-indigo-500/20 rounded-2xl space-y-4 shadow-xl shadow-indigo-500/5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              {isEditing === 'new' ? <><Plus className="h-5 w-5 text-indigo-400" /> Create New Promo</> : <><Edit2 className="h-5 w-5 text-indigo-400" /> Edit Promo</>}
            </h3>
            {/* Templates picker */}
            <button
              onClick={() => setShowTemplates(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-lg text-xs font-bold transition-all"
            >
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              Prefill Template
              {showTemplates ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>

          {/* Templates dropdown */}
          {showTemplates && (
            <div className="grid gap-2 p-3 bg-white/5 border border-white/10 rounded-xl">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Choose a template to auto-fill the message:</p>
              {PROMO_TEMPLATES.map((t, i) => (
                <button
                  key={i}
                  onClick={() => applyTemplate(t)}
                  className="text-left px-3 py-2.5 bg-[#121214] hover:bg-indigo-500/10 hover:border-indigo-500/30 border border-white/5 rounded-lg transition-all"
                >
                  <span className="text-sm font-bold text-white/80">{t.label}</span>
                  <p className="text-[10px] text-white/30 mt-0.5 line-clamp-1">{t.text.replace(/<[^>]+>/g, '').slice(0, 80)}…</p>
                </button>
              ))}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-2">
                Message Text <span className="text-indigo-400">(HTML supported)</span>
              </label>
              <textarea
                value={formText}
                onChange={(e) => setFormText(e.target.value)}
                placeholder="Enter the message text here... HTML tags like <b>, <a href='...'> are supported."
                rows={6}
                className="w-full px-4 py-3 bg-[#121214] border border-white/10 rounded-xl text-sm text-white placeholder-white/20 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 outline-none resize-y font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-2">
                Photo URL <span className="text-white/30">(Optional)</span>
              </label>
              <div className="relative">
                <ImageIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <input
                  type="text"
                  value={formPhoto}
                  onChange={(e) => setFormPhoto(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  className="w-full pl-10 pr-4 py-2.5 bg-[#121214] border border-white/10 rounded-xl text-sm text-white placeholder-white/20 focus:border-indigo-500/50 outline-none"
                />
              </div>
            </div>

            <label className="flex items-center gap-3 cursor-pointer group">
              <div
                onClick={() => setFormIsActive(v => !v)}
                className={`w-10 h-6 rounded-full transition-all relative ${formIsActive ? 'bg-indigo-500' : 'bg-white/10'}`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow-sm ${formIsActive ? 'left-5' : 'left-1'}`} />
              </div>
              <span className="text-sm font-medium text-white/80 group-hover:text-white transition-colors">
                Active — include in daily rotation
              </span>
            </label>
          </div>

          <div className="flex justify-end items-center gap-3 pt-4 border-t border-white/10">
            <button onClick={cancelEdit} className="px-4 py-2 text-sm font-medium text-white/60 hover:text-white transition-colors flex items-center gap-1.5">
              <X className="h-4 w-4" /> Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!formText.trim() || !!savingId}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex items-center space-x-2 transition-colors"
            >
              <Check className="h-4 w-4" />
              <span>{savingId ? 'Saving...' : 'Save Promo'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Promo Cards */}
      <div className="grid gap-4">
        {promos.length === 0 && !loading && !isEditing ? (
          <div className="text-center py-16 glass border border-white/5 rounded-2xl">
            <Send className="h-12 w-12 text-white/10 mx-auto mb-4" />
            <h3 className="text-white font-bold text-lg">No Promos Yet</h3>
            <p className="text-white/30 text-sm mt-2 max-w-xs mx-auto">Create your first promo message to start sending daily automated posts to your Telegram channel.</p>
            <button
              onClick={() => startEdit()}
              className="mt-6 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold flex items-center gap-2 mx-auto transition-all"
            >
              <Zap className="h-4 w-4" /> Use a Prefill Template
            </button>
          </div>
        ) : (
          promos.map((promo) => (
            <div
              key={promo.id}
              className={`p-5 glass border rounded-2xl flex flex-col md:flex-row gap-4 transition-all ${promo.isActive ? 'border-white/10' : 'border-white/5 opacity-60'}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-3 gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-widest ${promo.isActive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-white/5 text-white/40 border border-white/10'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${promo.isActive ? 'bg-emerald-400' : 'bg-white/40'}`} />
                      {promo.isActive ? 'Active' : 'Paused'}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-white/30 font-mono">
                      <Clock className="h-3 w-3" />
                      {new Date(promo.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Message Preview */}
                <div className="bg-[#0A0A0C] border border-white/5 rounded-xl p-4 text-sm text-white/70 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                  {promo.text}
                </div>

                {promo.photo && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-indigo-400">
                    <ImageIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    <a href={promo.photo} target="_blank" rel="noopener noreferrer" className="hover:underline truncate max-w-xs">
                      {promo.photo}
                    </a>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex md:flex-col items-center md:items-stretch gap-2 md:pl-4 md:border-l md:border-white/5 flex-shrink-0">
                <button
                  onClick={() => handleSendNow(promo.id)}
                  disabled={!!sendingNow || !envStatus?.hasBotToken || !envStatus?.hasChannelId}
                  title={!envStatus?.hasChannelId ? 'TELEGRAM_PUBLIC_CHANNEL_ID not set' : 'Send to channel now'}
                  className="flex-1 md:w-36 px-3 py-2 text-xs font-bold rounded-xl border transition-all flex items-center justify-center gap-1.5 bg-sky-500/10 border-sky-500/20 text-sky-400 hover:bg-sky-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send className={`h-3.5 w-3.5 ${sendingNow === promo.id ? 'animate-pulse' : ''}`} />
                  {sendingNow === promo.id ? 'Sending...' : 'Send Now'}
                </button>
                <button
                  onClick={() => handleToggleActive(promo.id, promo.isActive)}
                  disabled={savingId === promo.id}
                  className={`flex-1 md:w-36 px-3 py-2 text-xs font-bold rounded-xl border transition-all flex items-center justify-center gap-1.5 ${
                    promo.isActive
                      ? 'border-white/10 hover:border-amber-500/50 hover:text-amber-400 text-white/60'
                      : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                  }`}
                >
                  {promo.isActive ? 'Pause' : 'Activate'}
                </button>
                <button
                  onClick={() => startEdit(promo)}
                  className="flex-1 md:w-36 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold text-white transition-all flex items-center justify-center gap-1.5"
                >
                  <Edit2 className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  onClick={() => handleDelete(promo.id)}
                  disabled={savingId === promo.id}
                  className="flex-1 md:w-36 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 rounded-xl text-xs font-bold text-red-400 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer hint */}
      {promos.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-white/20 pt-2 border-t border-white/5">
          <Clock className="h-3.5 w-3.5" />
          <span>Data auto-refreshes silently in the background every 30 seconds.</span>
        </div>
      )}
    </div>
  )
}
