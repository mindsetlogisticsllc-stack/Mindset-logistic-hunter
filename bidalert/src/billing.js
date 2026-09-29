"use strict";

const crypto = require("crypto");
const config = require("./config");
const db = require("./db");

const LIVE_STATUSES = ["active", "trialing", "past_due"];

function billingConfigured() {
  return Boolean(config.STRIPE_SECRET_KEY && config.STRIPE_PRICE_ALERTS);
}

async function stripe(path, params) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params).toString()
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.url) {
    throw new Error(`Stripe ${path} failed: ${JSON.stringify(data).slice(0, 300)}`);
  }

  return data;
}

async function getSubscription(userId) {
  const result = await db.query(`SELECT * FROM subscriptions WHERE user_id=$1`, [userId]);
  return result.rows[0] || { status: "none" };
}

function hasAccess(subscription) {
  return LIVE_STATUSES.includes(subscription?.status);
}

async function checkoutUrl(user, baseUrl) {
  const subscription = await getSubscription(user.id);

  const params = {
    mode: "subscription",
    "line_items[0][price]": config.STRIPE_PRICE_ALERTS,
    "line_items[0][quantity]": "1",
    success_url: `${baseUrl}/dashboard?welcome=1`,
    cancel_url: `${baseUrl}/dashboard`,
    client_reference_id: user.id,
    "metadata[user_id]": user.id,
    "subscription_data[metadata][user_id]": user.id
  };

  if (subscription.stripe_customer_id) {
    params.customer = subscription.stripe_customer_id;
  } else {
    params.customer_email = user.email;

    // Only first-time subscribers get the free trial.
    if (config.TRIAL_DAYS > 0) {
      params["subscription_data[trial_period_days]"] = String(config.TRIAL_DAYS);
    }
  }

  return (await stripe("checkout/sessions", params)).url;
}

async function portalUrl(user, baseUrl) {
  const subscription = await getSubscription(user.id);

  if (!subscription.stripe_customer_id) {
    return null;
  }

  return (
    await stripe("billing_portal/sessions", {
      customer: subscription.stripe_customer_id,
      return_url: `${baseUrl}/dashboard`
    })
  ).url;
}

function verifySignature(rawBody, header, secret, nowSeconds = Date.now() / 1000) {
  if (!header || !secret) {
    return false;
  }

  const parts = String(header)
    .split(",")
    .map((part) => part.split("="));

  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);

  if (!Number.isFinite(timestamp) || !signatures.length || Math.abs(nowSeconds - timestamp) > 300) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return signatures.some((candidate) => {
    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

async function upsertSubscription(userId, fields) {
  await db.query(
    `INSERT INTO subscriptions (user_id, status, stripe_customer_id, stripe_subscription_id, current_period_end, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       status = EXCLUDED.status,
       stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
       stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, subscriptions.stripe_subscription_id),
       current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
       updated_at = NOW()`,
    [
      userId,
      fields.status,
      fields.customer || null,
      fields.subscription || null,
      fields.periodEnd ? new Date(fields.periodEnd * 1000).toISOString() : null
    ]
  );
}

async function handleEvent(event) {
  const object = event.data?.object || {};

  if (event.type === "checkout.session.completed" && object.mode === "subscription") {
    const userId = object.metadata?.user_id || object.client_reference_id;

    if (userId) {
      // The subscription events below refine this to trialing/active.
      await upsertSubscription(userId, {
        status: "active",
        customer: object.customer,
        subscription: object.subscription
      });
    }

    return;
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const status = event.type === "customer.subscription.deleted" ? "canceled" : object.status;
    const periodEnd = object.current_period_end || object.items?.data?.[0]?.current_period_end;
    const userId = object.metadata?.user_id;

    if (userId) {
      await upsertSubscription(userId, {
        status,
        customer: object.customer,
        subscription: object.id,
        periodEnd
      });
    } else {
      await db.query(
        `UPDATE subscriptions SET status=$1, current_period_end=COALESCE($2, current_period_end), updated_at=NOW()
         WHERE stripe_subscription_id=$3`,
        [status, periodEnd ? new Date(periodEnd * 1000).toISOString() : null, object.id]
      );
    }
  }
}

module.exports = {
  LIVE_STATUSES,
  billingConfigured,
  getSubscription,
  hasAccess,
  checkoutUrl,
  portalUrl,
  verifySignature,
  handleEvent
};
