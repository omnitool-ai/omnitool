/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

function escapeHtmlSpecialChars(text: string) {
  if (!text || text.length === 0) {
    console.warn('null text passed into escapeHtmlSpecialChars');
    return '';
  }
  const map: Record<string, string> = {
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[<>&"']/g, (m) => map[m]);
}

export { escapeHtmlSpecialChars };
