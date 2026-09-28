const source = `<style>
* {box-sizing:border-box}
body {font-family:system-ui,sans-serif;font-size:14px;line-height:1.45;color:#243d38;background:#f5f2e9}
.story {padding:24px}
h1 {font-size:26px;line-height:1.2;margin:0 0 8px}
.intro {margin:0 0 20px;color:#547065}
.steps {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.step {background:white;border:1px solid #ccd9cc;border-radius:14px;padding:16px}
.eyebrow {font-size:12px;font-weight:700;color:#547c65;margin:0 0 8px}
h2 {font-size:18px;line-height:1.25;margin:0 0 14px}
.screen {background:#f4f7f3;border:1px solid #d7e1d4;border-radius:8px;padding:12px;min-height:116px;margin-bottom:16px}
.screen-title {font-size:12px;font-weight:700;margin:0 0 10px}
.choice {background:white;border:1px solid #adc6b1;border-radius:6px;padding:8px;margin:0 0 8px}
.cta {display:inline-block;background:#e0eee2;color:#243d38;border-radius:6px;padding:6px 10px;font-weight:700;font-size:12px}
.response {font-size:13px;margin:0 0 10px}
.response strong {display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#547065;margin-bottom:3px}
.outcome {background:#deebfa;border-radius:6px;padding:8px;font-size:12px;margin:0}
.retry {display:grid;grid-template-columns:1fr 2fr;gap:16px;background:#fff9e9;border:1px solid #dccba2;border-radius:10px;padding:14px 16px;margin-top:16px}
.retry h2 {font-size:15px;margin:0}
.retry p {margin:0;font-size:13px}
@media (max-width:600px) {
  .story {padding:20px}
  h1 {font-size:24px}
  .steps {grid-template-columns:1fr;gap:14px}
  .screen {min-height:0}
  .retry {grid-template-columns:1fr;gap:8px}
}
</style>
<main class="story">
<header><h1>Schedule a repair</h1><p class="intro">Choose a time, check the details, and leave with a confirmed visit.</p></header>
<section class="steps">
<article class="step" id="choose-time" aria-label="Choose a time">
<p class="eyebrow">STEP 1 · CHOOSE</p><h2>Find a time that works</h2>
<div class="screen"><p class="screen-title">Available visits</p><p class="choice">Tuesday, 10:00–12:00</p><span class="cta">Use this time</span></div>
<p class="response"><strong>User action</strong>Select an available visit window.</p>
<p class="response"><strong>System response</strong>Hold the time and show the visit details.</p>
<p class="outcome"><b>Next state:</b> Review your visit.</p>
</article>
<article class="step" id="review-visit" aria-label="Review your visit">
<p class="eyebrow">STEP 2 · REVIEW</p><h2>Check before confirming</h2>
<div class="screen"><p class="screen-title">Your visit</p><p class="choice">Tuesday · 18 Oak Street</p><span class="cta">Confirm visit</span></div>
<p class="response"><strong>User action</strong>Check the address and confirm.</p>
<p class="response"><strong>System response</strong>Save the booking and send a confirmation.</p>
<p class="outcome"><b>Next state:</b> Booking confirmed.</p>
</article>
<article class="step" id="visit-confirmed" aria-label="Booking confirmed">
<p class="eyebrow">STEP 3 · DONE</p><h2>Know what happens next</h2>
<div class="screen"><p class="screen-title">Visit confirmed</p><p class="choice">Tuesday, 10:00–12:00</p><span class="cta">View booking</span></div>
<p class="response"><strong>User action</strong>Open the saved booking when needed.</p>
<p class="response"><strong>System response</strong>Show the visit window and preparation notes.</p>
<p class="outcome"><b>Outcome:</b> You are ready for the visit.</p>
</article>
</section>
<aside class="retry" id="time-unavailable" aria-label="Time unavailable retry">
<h2>If the time was just taken</h2>
<p><b>User action:</b> Choose another time. <b>System response:</b> Keep your address and show available windows. <b>Next state:</b> Return to Step 1 without starting over.</p>
</aside>
</main>`;

export const storyboardArtifacts = [
  { schemaVersion: 'artifact/v1', format: 'html', id: 'repair-story-wide', title: 'Repair booking · wide storyboard', source, width: 1000, height: 640 },
  { schemaVersion: 'artifact/v1', format: 'html', id: 'repair-story-narrow', title: 'Repair booking · narrow storyboard', source, width: 420, height: 1500 },
];

export const technicalArtifact = {
  schemaVersion: 'artifact/v1', format: 'mermaid', id: 'checkout-sequence',
  title: 'Checkout · interaction contract', width: 1000, height: 820,
  source: `sequenceDiagram
participant Customer
participant UI as Checkout UI
participant Orders as Order service
participant Payments as Payment provider
Customer->>UI: Confirm purchase
UI->>Orders: Submit bag and payment token
Orders->>Payments: Authorize payment
alt Payment accepted
Payments-->>Orders: Authorization accepted
Orders-->>UI: Order confirmed and receipt
UI-->>Customer: Show confirmation and clear bag
else Payment declined
Payments-->>Orders: Authorization declined
Orders-->>UI: Payment declined and bag retained
UI-->>Customer: Keep bag and offer retry
Customer->>UI: Choose another payment method
UI->>Orders: Retry retained bag with new token
end`,
};
