// Vercel Serverless Function
// Prüft per IMAP den 1&1-Posteingang (und Gesendet-Ordner) auf neue Dokument-Anhänge.
// Zugangsdaten liegen NUR server-seitig als Umgebungsvariablen, nie im Browser.
// Erreichbar unter: /api/fetch-emails

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const DOKUMENT_ENDUNGEN = /\.(pdf|jpe?g|png|heic)$/i;
const DOKUMENT_MIMETYPEN = /pdf|jpe?g|jpg|png|heic/i;
const SIGNATUR_BILD_MUSTER = /^image\d{0,4}\.(png|jpe?g|gif)$/i;

async function findeOrdner(client, muster) {
  const alle = await client.list();
  return alle.find((o) => muster.test(o.path) || muster.test(o.name));
}

async function leseAnhaengeAusOrdner(client, ordnerPfad, suchKriterium, quelle) {
  const treffer = [];
  let lock;
  try {
    lock = await client.getMailboxLock(ordnerPfad);
  } catch {
    return treffer; // Ordner existiert nicht / kein Zugriff -> überspringen
  }
  try {
    const uids = await client.search(suchKriterium, { uid: true });
    for (const uid of uids || []) {
      let msg;
      try {
        msg = await client.fetchOne(uid, { source: true }, { uid: true });
      } catch { continue; }
      if (!msg || !msg.source) continue;

      let parsed;
      try {
        parsed = await simpleParser(msg.source);
      } catch { continue; }

      const anhaenge = (parsed.attachments || []).filter((a) => {
        const istEchterAnhang = a.contentDisposition !== "inline" && !a.related;
        const passtTyp = DOKUMENT_MIMETYPEN.test(a.contentType || "") || DOKUMENT_ENDUNGEN.test(a.filename || "");
        const ausreichendGross = (a.size || (a.content ? a.content.length : 0)) > 25 * 1024; // Logos/Icons sind fast immer kleiner als 25 KB
        const keinSignaturBild = !SIGNATUR_BILD_MUSTER.test(a.filename || "");
        return istEchterAnhang && passtTyp && ausreichendGross && keinSignaturBild;
      });
      for (const a of anhaenge) {
        treffer.push({
          quelle,
          messageUid: uid,
          ordner: ordnerPfad,
          betreff: parsed.subject || "",
          von: parsed.from?.text || "",
          datum: parsed.date ? parsed.date.toISOString() : null,
          dateiname: a.filename || `anhang_${uid}`,
          mediaType: (a.contentType || "application/octet-stream").split(";")[0].trim(),
          base64: a.content.toString("base64"),
        });
      }
    }
  } finally {
    if (lock) lock.release();
  }
  return treffer;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Nur POST erlaubt" });

  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASSWORD;
  if (!user || !pass) {
    return res.status(500).json({ error: "IMAP_USER / IMAP_PASSWORD sind auf dem Server nicht gesetzt" });
  }

  const { seitDatum, von, bis } = req.body || {};
  const seit = von ? new Date(von) : (seitDatum ? new Date(seitDatum) : new Date(Date.now() - 7 * 24 * 3600 * 1000));
  const vor = bis ? new Date(bis) : null;
  const suchKriterium = vor ? { since: seit, before: vor } : { since: seit };

  const client = new ImapFlow({
    host: "imap.1und1.de",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();

    const gesendetOrdner = await findeOrdner(client, /sent|gesendet/i);

    const posteingang = await leseAnhaengeAusOrdner(client, "INBOX", suchKriterium, "posteingang");
    const gesendet = gesendetOrdner
      ? await leseAnhaengeAusOrdner(client, gesendetOrdner.path, suchKriterium, "gesendet")
      : [];

    await client.logout();

    return res.status(200).json({
      anhaenge: [...posteingang, ...gesendet],
      geprueftAm: new Date().toISOString(),
    });
  } catch (err) {
    try { await client.logout(); } catch { /* ignorieren */ }
    return res.status(500).json({ error: String(err.message || err) });
  }
}
