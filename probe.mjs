import WebSocket from "ws";

const cookie = process.env.WANDERLOG_COOKIE;
const tripKey = process.env.WANDERLOG_TRIP_KEY;

if (!cookie || !tripKey) {
  console.error("missing WANDERLOG_COOKIE or WANDERLOG_TRIP_KEY in env");
  process.exit(1);
}

const url = `wss://wanderlog.com/api/tripPlans/wsOverall/${tripKey}?clientSchemaVersion=2`;

console.log(`[probe] connecting to ${url}`);

const ws = new WebSocket(url, {
  headers: {
    Cookie: cookie,
    Origin: "https://wanderlog.com",
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  },
});

const send = (obj) => {
  const s = JSON.stringify(obj);
  console.log(`[send] ${s}`);
  ws.send(s);
};

ws.on("open", () => {
  console.log("[probe] open");
  send({ a: "hs", id: null, protocol: 1, protocolMinor: 2 });
});

let gotHandshake = false;

ws.on("message", (raw) => {
  const text = raw.toString();
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    console.log(`[recv raw] ${text}`);
    return;
  }

  if (msg.a === "init") {
    console.log(`[recv init] session=${msg.id} type=${msg.type}`);
  } else if (msg.a === "hs" && !gotHandshake) {
    gotHandshake = true;
    console.log(`[recv hs]  session=${msg.id}`);
    send({ a: "s", c: "TripPlans", d: tripKey });
  } else if (msg.a === "s" && msg.data) {
    const doc = msg.data.data;
    console.log(`[recv snapshot] v=${msg.data.v}`);
    console.log(`  title:      ${doc.title}`);
    console.log(`  key:        ${doc.key}`);
    console.log(`  userId:     ${doc.userId}`);
    console.log(`  dates:      ${doc.startDate} → ${doc.endDate} (${doc.days} days)`);
    console.log(`  privacy:    ${doc.privacy}`);
    console.log(`  placeCount: ${doc.placeCount}`);
    console.log(`  sections:   ${doc.itinerary?.sections?.length ?? "?"}`);
    doc.itinerary?.sections?.forEach((s, i) => {
      console.log(
        `    [${i}] type=${s.type} mode=${s.mode} heading="${s.heading}" date=${s.date ?? "-"} blocks=${s.blocks?.length ?? 0}`
      );
    });
    console.log(`  contributors: ${doc.contributors?.map((c) => c.username).join(", ")}`);
    console.log("[probe] snapshot complete — closing");
    ws.close();
  } else {
    console.log(`[recv ${msg.a ?? "?"}] ${text.slice(0, 200)}`);
  }
});

ws.on("close", (code, reason) => {
  console.log(`[probe] closed code=${code} reason="${reason}"`);
  process.exit(0);
});

ws.on("error", (err) => {
  console.error(`[probe] error: ${err.message}`);
  process.exit(1);
});

setTimeout(() => {
  console.error("[probe] timeout after 15s");
  process.exit(2);
}, 15000);
