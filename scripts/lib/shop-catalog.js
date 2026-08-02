const SHOP_COINRAIN_AMOUNT = 500;

const SHOP_ITEMS = [
  {
    id: 'nickname',
    choiceName: 'Set Nickname (Self) - 1,000 Coins',
    title: 'Self Nickname',
    cost: 1000,
    summary: 'Change your own server nickname for 1 hour.',
    usage: '/buy item:nickname value:NewName',
    requiresValue: true,
    valueDescription: 'the nickname to use',
    maxValueLength: 32,
  },
  {
    id: 'heckle',
    choiceName: 'Heckle Target User - 1,500 Coins',
    title: 'Heckle User',
    cost: 1500,
    summary: "Change a target user's nickname to something silly for 1 hour.",
    usage: '/buy item:heckle target:@User value:SillyName',
    requiresValue: true,
    requiresTarget: true,
    valueDescription: 'the temporary nickname',
    targetDescription: 'the user to heckle',
    maxValueLength: 32,
  },
  {
    id: 'color',
    choiceName: 'Custom Color Role (24h) - 2,500 Coins',
    title: 'Custom Color Role',
    cost: 2500,
    summary: 'Get a personal visible hex color role for 24 hours.',
    usage: '/buy item:color value:#FF0055',
    requiresValue: true,
    valueDescription: 'a hex color like #FF0055',
    maxValueLength: 7,
  },
  {
    id: 'shoutout',
    choiceName: 'Broadcast Shoutout - 800 Coins',
    title: 'Broadcast Shoutout',
    cost: 800,
    summary: 'Post a styled shoutout message in the current channel.',
    usage: '/buy item:shoutout value:Hello World!',
    requiresValue: true,
    valueDescription: 'the shoutout text',
    maxValueLength: 600,
  },
  {
    id: 'timeout',
    choiceName: 'Timeout User (5m) - 5,000 Coins',
    title: 'Timeout User',
    cost: 5000,
    summary: 'Put a target user in Discord timeout for 5 minutes.',
    usage: '/buy item:timeout target:@User',
    requiresTarget: true,
    targetDescription: 'the user to timeout',
  },
  {
    id: 'pin',
    choiceName: 'Pin Message - 3,000 Coins',
    title: 'Pin Message',
    cost: 3000,
    summary: 'Pin a message in the current channel by message ID.',
    usage: '/buy item:pin value:123456789012345678',
    requiresValue: true,
    valueDescription: 'the message ID to pin',
    maxValueLength: 32,
  },
  {
    id: 'spotlight',
    choiceName: 'Community Spotlight - 1,200 Coins',
    title: 'Community Spotlight',
    cost: 1200,
    summary: 'Post a polished spotlight embed for yourself or a target user.',
    usage: '/buy item:spotlight target:@User value:Great helper!',
    valueDescription: 'an optional spotlight note',
    maxValueLength: 280,
  },
  {
    id: 'coinrain',
    choiceName: 'Coin Rain Pouch - 2,200 Coins',
    title: 'Coin Rain Pouch',
    cost: 2200,
    summary: `Spawn a public claim button worth ${SHOP_COINRAIN_AMOUNT} coins for the fastest member.`,
    usage: '/buy item:coinrain',
  },
  {
    id: 'thread',
    choiceName: 'Pop-up Thread (24h) - 1,800 Coins',
    title: 'Pop-up Thread',
    cost: 1800,
    summary: 'Create a public 24-hour discussion thread in the current channel.',
    usage: '/buy item:thread value:Thread Name',
    requiresValue: true,
    valueDescription: 'the thread name',
    maxValueLength: 80,
  }
];

function formatCoins(amount) {
  return Number(amount || 0).toLocaleString('en-US');
}

function getShopItem(id) {
  return SHOP_ITEMS.find((item) => item.id === id) || null;
}

function shopPricing() {
  return Object.fromEntries(SHOP_ITEMS.map((item) => [item.id, item.cost]));
}

function shopCommandChoices() {
  return SHOP_ITEMS.map((item) => ({
    name: item.choiceName,
    value: item.id,
  }));
}

function shopEmbedFields() {
  return SHOP_ITEMS.map((item) => ({
    name: `${item.title} (\`${item.id}\`)`,
    value: [
      `Cost: **${formatCoins(item.cost)} Coins**`,
      item.summary,
      `Usage: \`${item.usage}\``,
    ].join('\n'),
    inline: false,
  }));
}

module.exports = {
  SHOP_COINRAIN_AMOUNT,
  SHOP_ITEMS,
  formatCoins,
  getShopItem,
  shopCommandChoices,
  shopEmbedFields,
  shopPricing,
};
