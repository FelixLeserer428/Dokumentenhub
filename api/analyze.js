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

  const systemPrompt = `Du bist ein Assistent für ein persönliches Dokumentenablage-System. Du bekommst ein Foto eines gescannten Dokuments (Rechnung, Vertrag, Behördenschreiben, SEPA-Mandat etc). Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, kein Markdown, kein Fließtext, keine Backticks, kein Text davor oder danach:
{
  "kategorie_id": eine von: vermietung, rechnungen_steuer, rechnungen_privat, steuer, versicherungen, bank, behoerden, kleingewerbe, sonstiges,
  "dokumenttyp": kurzer Begriff z.B. "Nebenkostenabrechnung", "Stromrechnung", "SEPA-Lastschriftmandat",
  "absender": Name des Absenders/der Firma, so kurz wie möglich,
  "betrag": Gesamtbetrag inkl. Währung falls erkennbar, sonst null,
  "betrag_netto": Nettobetrag falls separat ausgewiesen, sonst null,
  "betrag_mwst": MwSt-Betrag falls separat ausgewiesen, sonst null,
  "datum": Dokumentdatum im Format YYYY-MM-DD falls erkennbar, sonst null,
  "faelligkeitsdatum": Zahlungsziel/Fälligkeitsdatum im Format YYYY-MM-DD falls vorhanden, sonst null,
  "ist_wiederkehrend": true wenn erkennbar ein wiederkehrender Vorgang ist (SEPA-Dauerauftrag, Miete, Versicherungsbeitrag, Abo), sonst false,
  "referenznummer": Rechnungs-, Vertrags-, Kunden- oder Mandatsreferenznummer falls vorhanden, sonst null,
  "iban": IBAN falls im Dokument genannt, sonst null,
  "zusammenfassung": ein Satz, worum es im Dokument geht,
  "konfidenz": Zahl zwischen 0 und 1, wie sicher du bei kategorie_id und den Kernfeldern bist,
  "mehrseiten_hinweis": falls auf dem Dokument etwas wie "Seite X von Y" mit Y > 1 steht, dieser Text (z.B. "Seite 2 von 3"), sonst null,
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
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
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

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return res.status(anthropicRes.status).json({ error: `Anthropic API Fehler: ${errText.slice(0, 300)}` });
    }

    const data = await anthropicRes.json();
    const textBlock = data.content?.find((b) => b.type === "text");
    if (!textBlock) return res.status(500).json({ error: "Keine Textantwort von Claude erhalten" });

    let parsed;
    try {
      let clean = textBlock.text.replace(/```json|```/g, "").trim();
      const start = clean.indexOf("{");
      const end = clean.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        clean = clean.slice(start, end + 1);
      }
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      return res.status(502).json({
        error: "Antwort der KI konnte nicht als JSON gelesen werden. Bitte Angaben manuell eintragen.",
        rohtext: textBlock.text.slice(0, 300),
      });
    }
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
