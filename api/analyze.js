// Vercel Serverless Function
// Läuft NUR auf dem Server, nie im Browser -> der API-Key bleibt geheim.
// Erreichbar unter: /api/analyze

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Nur POST erlaubt" });
  }

  const { base64Image, mediaType } = req.body || {};
  if (!base64Image || !mediaType) {
    return res.status(400).json({ error: "base64Image und mediaType erforderlich" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY ist auf dem Server nicht gesetzt" });
  }

  const systemPrompt = `Du bist ein Assistent für ein persönliches Dokumentenablage-System. Du bekommst ein Foto eines gescannten Dokuments (Rechnung, Vertrag, Behördenschreiben etc). Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, kein Markdown, kein Fließtext, keine Backticks:
{
  "kategorie_id": eine von: vermietung, rechnungen_steuer, rechnungen_privat, steuer, versicherungen, bank, behoerden, kleingewerbe, sonstiges,
  "dokumenttyp": kurzer Begriff z.B. "Nebenkostenabrechnung", "Stromrechnung", "Kontoauszug",
  "absender": Name des Absenders/der Firma, so kurz wie möglich,
  "betrag": Betrag inkl. Währung falls erkennbar, sonst null,
  "datum": Dokumentdatum im Format YYYY-MM-DD falls erkennbar, sonst null,
  "zusammenfassung": ein Satz, worum es im Dokument geht,
  "vorgeschlagener_dateiname": Vorschlag ohne Dateiendung, Format: JAHR-MONAT-TAG_Dokumenttyp_Absender, nur Buchstaben/Zahlen/Unterstriche
}`;

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
              { type: "text", text: "Analysiere dieses Dokument und antworte nur mit dem JSON-Objekt." },
            ],
          },
        ],
      }),
    });
