// ─────────────────────────────────────────────
// RejuvaSleep settings — edit these, nothing else
// ─────────────────────────────────────────────
window.REJUVA_CONFIG = {
  // PayPal checkout button (public Client ID from your RejuvaSleep PayPal app)
  paypalClientId: "BAAJsh04g7GeCQy_46Id79gn9L9V2221fTawIO4BbwVCc6srBSGhX9cA4UGut9-3wVAKKeUBtL_2-utOm0",

  // Monthly subscription: create the plan in PayPal, then paste its Plan ID here (starts with P-)
  paypalPlanId: "P-6BJ005219R9397542NLUO7RQ",
  introPrice: "$9.99",      // first month
  monthlyPrice: "$19.99",   // every month after

  price: "$9.99",           // shown on the offer: first-month price
  comparePrice: "$19.99",   // crossed out next to it
  priceNote: "First month, then $19.99/month · cancel anytime",

  supportEmail: "rejuvasleep.help@gmail.com",  // the email customers can contact for help

  // Supabase (public values — safe to be in website code)
  supabaseUrl: "https://ufgsbldkedtguscfdkvg.supabase.co",
  supabaseKey: "sb_publishable_w6v6w96vEHMUqRwDdNg_9w_eA7lIreY"
};
