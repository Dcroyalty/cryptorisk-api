// lib/billing.ts — Stripe event -> api_keys state transitions.
// Kept apart from the webhook route so the event-handling logic can be
// exercised directly (constructing a Stripe.Event by hand) without spinning
// up an HTTP server or needing a live Stripe account.
import type Stripe from "stripe";
import { mintKey, syncSubscriptionStatus, deactivateBySubscription } from "@/lib/keys";
import { planFromPriceId, stripe } from "@/lib/stripe";

// Deps are injectable so tests can stub the one real network call this makes
// (retrieving the subscription for its period bounds) without hitting Stripe.
export interface BillingDeps {
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>;
}

const defaultDeps: BillingDeps = {
  retrieveSubscription: (id) => stripe().subscriptions.retrieve(id),
};

function periodFromSubscription(sub: Stripe.Subscription): { start: Date; end: Date } {
  const item = sub.items.data[0];
  return {
    start: new Date((item?.current_period_start ?? sub.start_date ?? 0) * 1000),
    end: new Date((item?.current_period_end ?? 0) * 1000),
  };
}

export async function handleStripeEvent(event: Stripe.Event, deps: BillingDeps = defaultDeps): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") return; // not one of our subscription checkouts
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (!subscriptionId || !customerId) return;

      const sub = await deps.retrieveSubscription(subscriptionId);
      const priceId = sub.items.data[0]?.price?.id;
      const plan = planFromPriceId(priceId);
      if (!plan) throw new Error(`checkout.session.completed: unrecognized price id "${priceId}" on subscription ${subscriptionId}`);

      const { start, end } = periodFromSubscription(sub);
      await mintKey({ stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId, plan, periodStart: start, periodEnd: end });
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const priceId = sub.items.data[0]?.price?.id;
      const plan = planFromPriceId(priceId);
      if (!plan) break; // not one of our products
      const { start, end } = periodFromSubscription(sub);
      await syncSubscriptionStatus({ stripeSubscriptionId: sub.id, status: sub.status, plan, periodStart: start, periodEnd: end });
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await deactivateBySubscription(sub.id);
      break;
    }

    default:
      break; // everything else is ignored
  }
}
