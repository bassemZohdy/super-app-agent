/** What each named failpoint does, in the words the console shows. The names come from the provider's registry, so a new failpoint
 *  cannot be armed from the console until it is described here (a test keeps the two in step). */
import { FAILPOINTS } from '../../services/provider-simulator/src/failpoints.ts';

const DESCRIPTIONS: Record<(typeof FAILPOINTS)[number], string> = {
  'checkout.after-admission': 'the order is admitted, then the response is lost before any money moves',
  'checkout.after-capture-commit': 'the capture commits, then the response is lost',
  'checkout.after-settlement-request': 'the settlement request is sent, then its response is lost',
  'funding.after-commit': 'a wallet funding commits, then the response is lost',
};

export const describedFailpoints = () => FAILPOINTS.map(name => ({ name: name as string, description: DESCRIPTIONS[name] }));
