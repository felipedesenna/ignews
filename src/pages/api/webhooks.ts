import { NextApiRequest, NextApiResponse } from 'next';
import { Readable } from 'stream';

import Stripe from 'stripe';

import { stripe } from '../../services/stripe';
import { saveSubscription } from '../api/_lib/manageSubscription';

async function buffer(readable: Readable) {
  const chunks = [];

  for await (const chunk of readable) {
    chunks.push(
      typeof chunk === 'string' ? Buffer.from(chunk) : chunk,
    );
  }

  return Buffer.concat(chunks);
}

export const config = {
  api: {
    bodyParser: false,
  }
}

const relevantEvents = new Set([
  'checkout.session.completed',
]);

const events = (type: string, data) => {
  let event = {
    'checkout.session.completed': async () => {
      const checkoutSession = data.object as Stripe.Checkout.Session;

      await saveSubscription(
        checkoutSession.subscription.toString(),
        checkoutSession.customer.toString(),
      );
    },
    'default': () => { throw new Error('Unhandled event.') },
  };

  return event[type] || event['default'];
}

export default async (request: NextApiRequest, response: NextApiResponse) => {
  if (request.method === 'POST') {
    const buf = await buffer(request);
    const secret = request.headers['stripe-signature'];

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(buf, secret, process.env.STRIPE_WEBHOOKS_SECRET);
    } catch (err) {
      return response.status(400).send(`Webhook error: ${err.message}`);
    }

    const { type } = event;

    if (relevantEvents.has(type)) {
      try {
        events(type, event);
      } catch (err) {
        return response.json({ error: 'Webhook handler failed.' });
      }
    }

    response.json({ received: true });
  } else {
    response.setHeader('Allow', 'POST');
    response.status(405).end('Method not allowed');
  }
}
