export interface ImportedPhoneContact {
  name: string
  phones: string[]
}

const unescapeVCard = (value: string) =>
  value.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim()

export const parseVCardText = (source: string): ImportedPhoneContact[] => {
  const unfolded = source.replace(/\r?\n[ \t]/g, '')
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1)
  const contacts: ImportedPhoneContact[] = []
  for (const card of cards) {
    const lines = card.split(/\r?\n/)
    let name = ''
    const phones: string[] = []
    for (const line of lines) {
      const separator = line.indexOf(':')
      if (separator < 0) continue
      const key = line.slice(0, separator).split(';')[0].toUpperCase()
      const value = unescapeVCard(line.slice(separator + 1))
      if (key === 'FN' || key === 'N' && !name) name ||= value.replace(/;/g, ' ').trim()
      if (key === 'TEL' && value) phones.push(value)
    }
    const uniquePhones = [...new Set(phones)]
    if (uniquePhones.length) contacts.push({ name: name || 'Без имени', phones: uniquePhones })
  }
  return contacts
}

export const readVCardFile = async (file: File): Promise<ImportedPhoneContact[]> => {
  if (!/\.vcf$/i.test(file.name) && !/text\/vcard/i.test(file.type)) {
    throw new Error('Выберите файл контактов .vcf.')
  }
  if (file.size > 10_000_000) throw new Error('Файл контактов слишком большой (максимум 10 МБ).')
  return parseVCardText(await file.text())
}
