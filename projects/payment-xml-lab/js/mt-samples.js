// Made-up MT103 samples, each built to show one migration problem. Made-up companies, published example IBANs,
// made-up BICs (bank code XMPL) and made-up UETRs. Never real messages.
const H = (uetr, extra = '') => `{1:F01XMPLDEFFAXXX0000000000}{2:I103XMPLFRPPXXXXN}{3:${extra}${uetr ? `{121:${uetr}}` : ''}}{4:`;

export const MT_SAMPLES = [
  { id: 'clean', label: '1 · Clean: everything maps', text: `${H('3f1c2a7e-8b4d-4e21-9a6f-0c5d7e8f9a10')}
:20:XMPL2611180001
:23B:CRED
:32A:261118EUR1250,00
:50F:/DE89370400440532013000
1/LUMEN EXAMPLE TRADING GMBH
2/BEISPIELSTRASSE 12
3/DE/BERLIN
:59F:/FR1420041010050500013M02606
1/ALDER EXAMPLE STUDIO
2/12 RUE DE L EXEMPLE
3/FR/LYON
:70:INVOICE 2026-118
:71A:SHA
-}` },
  { id: 'address', label: '2 · Free-text addresses', text: `${H('7d2e9b14-3c5a-4f8e-b1d0-6a9c2e4f7b35')}
:20:XMPL2611180002
:23B:CRED
:32A:261118EUR4830,75
:50K:/NL91ABNA0417164300
LUMEN EXAMPLE TRADING BV
VOORBEELDSTRAAT 12
3511 AB UTRECHT
NL
:59:/FR1420041010050500013M02606
CEDAR EXAMPLE FOODS
12 RUE DE L EXEMPLE
69002 LYON
FRANCE
:70:ORDER 5521
:71A:SHA
:72:/REC/PLEASE ADVISE BENEFICIARY
//BY PHONE
-}` },
  { id: 'remittance', label: '3 · Rich remittance (/INV/, /RFB/)', text: `${H('c4a81f36-9e2b-4d7c-8f05-1b3e6a9d2c47')}
:20:XMPL2611180003
:23B:CRED
:32A:261118EUR980,40
:50F:/DE89370400440532013000
1/LUMEN EXAMPLE TRADING GMBH
2/BEISPIELSTRASSE 12
3/DE/BERLIN
:59F:/BE68539007547034
1/BIRCH EXAMPLE LOGISTICS
2/RUE DE L EXEMPLE 4
3/BE/BRUXELLES
:70:/INV/2026-118 2026-11-02
/RFB/RF18539007547034
/ROC/ORDER-5521
PAYMENT FOR SERVICES OCTOBER
:71A:SHA
-}` },
  { id: 'charges', label: '4 · Charges: SHA with two 71F', text: `${H('a9f3d5c2-6b1e-4a8d-9c7f-2e4b8d1a6c53')}
:20:XMPL2611180004
:23B:CRED
:32A:261118EUR1242,50
:33B:EUR1250,00
:50F:/DE89370400440532013000
1/LUMEN EXAMPLE TRADING GMBH
2/BEISPIELSTRASSE 12
3/DE/BERLIN
:59F:/FR1420041010050500013M02606
1/ALDER EXAMPLE STUDIO
2/12 RUE DE L EXEMPLE
3/FR/LYON
:70:INVOICE 2026-119
:71A:SHA
:71F:EUR2,50
:71F:EUR5,00
-}` },
  { id: 'our', label: '5 · Charges: OUR with 71G', text: `${H('5e7b2c9a-1d4f-4b6e-a3c8-9f0d2e5b7a14')}
:20:XMPL2611180005
:23B:CRED
:32A:261118EUR1265,00
:33B:EUR1250,00
:50F:/DE89370400440532013000
1/LUMEN EXAMPLE TRADING GMBH
2/BEISPIELSTRASSE 12
3/DE/BERLIN
:59F:/FR1420041010050500013M02606
1/ALDER EXAMPLE STUDIO
2/12 RUE DE L EXEMPLE
3/FR/LYON
:70:INVOICE 2026-120
:71A:OUR
:71G:EUR15,00
-}` },
  { id: 'no-uetr', label: '6 · Missing UETR', text: `${H(null, '{108:XMPLMUR0006}')}
:20:XMPL2611180006
:23B:CRED
:32A:261118EUR310,00
:50F:/DE89370400440532013000
1/LUMEN EXAMPLE TRADING GMBH
2/BEISPIELSTRASSE 12
3/DE/BERLIN
:59F:/FR1420041010050500013M02606
1/ALDER EXAMPLE STUDIO
2/12 RUE DE L EXEMPLE
3/FR/LYON
:70:INVOICE 2026-121
:71A:SHA
-}` },
  { id: 'broken', label: '7 · Broken MT: bad date, unknown tag', text: `${H('e1b6c8d3-4a2f-4e9b-8d7c-3f5a1b9e6d28')}
:20:XMPL2611180007
:21:RELATED-REF-77
:23B:CRED
:32A:261340EUR1250,00
:50F:/DE89370400440532013000
1/LUMEN EXAMPLE TRADING GMBH
2/BEISPIELSTRASSE 12
3/DE/BERLIN
:59F:/FR1420041010050500013M02606
1/ALDER EXAMPLE STUDIO
2/12 RUE DE L EXEMPLE
3/FR/LYON
:71A:SHA
-}` },
];

// A made-up native pacs.008 (not made from an MT), used only by the reverse check: long name, accents,
// a 180-character remittance and an instruction text, to show what an MT party would lose.
export const NATIVE_PACS008 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>XMPL-NATIVE-0001</MsgId>
      <CreDtTm>2026-11-18T09:30:00</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf><SttlmMtd>INDA</SttlmMtd></SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId><InstrId>XMPL-NATIVE-INSTRUCTION-0001</InstrId><EndToEndId>LUMEN-PO-2026-000118</EndToEndId><UETR>8c2d4f6a-1b3e-4c5d-9e7f-0a1b2c3d4e5f</UETR></PmtId>
      <IntrBkSttlmAmt Ccy="EUR">1250.00</IntrBkSttlmAmt>
      <IntrBkSttlmDt>2026-11-18</IntrBkSttlmDt>
      <ChrgBr>SHAR</ChrgBr>
      <InstgAgt><FinInstnId><BICFI>XMPLDEFFXXX</BICFI></FinInstnId></InstgAgt>
      <InstdAgt><FinInstnId><BICFI>XMPLFRPPXXX</BICFI></FinInstnId></InstdAgt>
      <Dbtr><Nm>Lumen Exemple Négoce et Logistique Européenne pour l'Industrie Agroalimentaire, la Restauration Collective &amp; les Métiers de Bouche SAS</Nm><PstlAdr><StrtNm>Große Beispielstraße</StrtNm><BldgNb>12</BldgNb><PstCd>10115</PstCd><TwnNm>Berlin</TwnNm><Ctry>DE</Ctry></PstlAdr></Dbtr>
      <DbtrAcct><Id><IBAN>DE89370400440532013000</IBAN></Id></DbtrAcct>
      <DbtrAgt><FinInstnId><BICFI>XMPLDEFFXXX</BICFI></FinInstnId></DbtrAgt>
      <CdtrAgt><FinInstnId><BICFI>XMPLFRPPXXX</BICFI></FinInstnId></CdtrAgt>
      <Cdtr><Nm>Atelier Cèdre Exemple</Nm><PstlAdr><StrtNm>Rue de l'Exemple</StrtNm><BldgNb>12</BldgNb><PstCd>69002</PstCd><TwnNm>Lyon</TwnNm><Ctry>FR</Ctry></PstlAdr></Cdtr>
      <CdtrAcct><Id><IBAN>FR1420041010050500013M02606</IBAN></Id></CdtrAcct>
      <InstrForNxtAgt><InstrInf>Please call the beneficiary on arrival; delivery note n° 118 refers.</InstrInf></InstrForNxtAgt>
      <RmtInf><Ustrd>Facture 2026-118 du 2 novembre 2026, commande 5521, livraison partielle de 40 caisses sur 60, solde à suivre</Ustrd><Ustrd>avec la facture 2026-131; escompte 2,0 % déduit, frais de port compris.</Ustrd></RmtInf>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>
`;
