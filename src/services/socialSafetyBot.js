const bannedWords = [
  'نصب', 'نصابين', 'نصابه', 'احتيال', 'محتال', 'كذب', 'كذاب', 'وهمي', 'سرقة',
  'خسارة', 'خسرت', 'راحت فلوسي', 'حظر', 'بلوك', 'قفلوا حسابي', 'ما يدفع',
  'سجلوا هنا', 'رابط خارجي', 'جروب تليجرام', 'scam', 'scammer', 'fake', 'fraud',
  'lie', 'stolen', 'lost money', 'banned', 'blocked', 'not paying', 'hack', 'hacker'
];

function findBannedWord(value) {
  const normalizedText = String(value || '').toLocaleLowerCase('ar').trim();
  return bannedWords.find(word => normalizedText.includes(word.toLocaleLowerCase('ar'))) || null;
}

function moderateText(value) {
  const matchedWord = findBannedWord(value);
  return { allowed: !matchedWord, status: matchedWord ? 'banned' : 'visible', matchedWord };
}

module.exports = { bannedWords, findBannedWord, moderateText };