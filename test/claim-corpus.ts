/**
 * Every human comment in the evaluation fixtures, labelled by hand: is this
 * person calling the issue?
 *
 * The bodies are not copied here. They are read from the recorded fixtures by
 * comment id, so the labels always sit next to the exact text GitHub returned.
 *
 * Labelled on 2026-09-22 while rewriting the claim patterns. The first version
 * of those patterns missed eight of the thirty claims below, and they were
 * missed in the dangerous direction — each one is somebody who would be
 * surprised to find a stranger's PR on their issue.
 *
 * `ambiguous` rows are left out of the score rather than forced into a side:
 * progress updates from somebody who already claimed (the claim itself is
 * what counts), a maintainer assigning the issue to somebody else (which names
 * the claimant, not the commenter), and "I can do it but ....if mentor online?".
 *
 * Like the ground truth, a label is never changed to make the patterns look
 * better. If a label is wrong, say why in a comment beside it.
 */

export type ClaimLabel = "claim" | "not-claim" | "ambiguous";

export const CLAIM_CORPUS: { id: number; label: ClaimLabel; note: string }[] = [
  // ohcnetwork/care_fe#16263
  { id: 4190909288, label: "claim", note: "kindly assign this issue to me" },
  { id: 4320108704, label: "claim", note: "can i take over from where the author left off?" },
  { id: 4320297445, label: "claim", note: "I would like to work on this issue" },
  { id: 4411607928, label: "claim", note: "I would like to work on this issue. My approach:" },
  { id: 4691869881, label: "claim", note: "I would like to request assignment for this issue" },
  { id: 4726736203, label: "claim", note: "can I take over from where the author left off?" },
  { id: 5318412201, label: "claim", note: "would like to work on this issue. Could you please assign it to me?" },

  // ohcnetwork/care_fe#16609
  { id: 5121309716, label: "not-claim", note: "an extra detail about the bug" },
  { id: 5139383087, label: "claim", note: "Could I please be assigned?" },
  { id: 5168798787, label: "claim", note: "I'd like to work on this issue" },
  { id: 5306017526, label: "claim", note: "can I take it and work on a fix?" },
  { id: 5318023851, label: "claim", note: "Could you please assign it to me?" },

  // openfoodfacts/openfoodfacts-explorer#1416, #1654, #1658, #1660
  { id: 4533798743, label: "not-claim", note: "a maintainer adding context" },
  { id: 4533816466, label: "not-claim", note: "oops sorry for the wrong ventilation" },
  { id: 4779440606, label: "claim", note: "can i work on this issue" },
  { id: 5688156515, label: "claim", note: "otherwise I will pick it up (hedged, still a claim)" },
  { id: 5105454791, label: "claim", note: "I'd like to work on this issue." },
  { id: 5411269843, label: "claim", note: "I'd like to take this one — could you assign it to me?" },
  { id: 5552381433, label: "claim", note: "I'd like to work on this issue" },
  { id: 5590052054, label: "claim", note: "I'd like to work on this issue as well" },

  // sugarlabs/musicblocks-v4#352
  { id: 1620585375, label: "claim", note: "i would like to work on this issue. Please assign it to me." },
  { id: 1625067210, label: "not-claim", note: "maintainer: Go ahead. Feel free to make a PR." },
  { id: 1752117765, label: "claim", note: "can i contribute for this issue ??" },
  { id: 1912536096, label: "claim", note: "May I work on this issue?" },
  { id: 2154551241, label: "claim", note: "can i work on this issue?" },
  { id: 3485509469, label: "claim", note: "in case can i work on it??" },
  { id: 3512965258, label: "ambiguous", note: "I can do it but ....if mentor online?" },
  { id: 3513022325, label: "claim", note: "I CAN IMPROVE IT ... {WORKING NOW}" },
  { id: 3513222188, label: "not-claim", note: "You can move ahead with your pr" },
  { id: 3513252839, label: "not-claim", note: "asking which other issue is free" },
  { id: 3566421407, label: "claim", note: "I would like to work on this issue" },
  { id: 5221415128, label: "claim", note: "i like to work on this issue and have started working on it" },
  { id: 5221565568, label: "claim", note: "i have made a pull request" },

  // sugarlabs/musicblocks-v4#679
  { id: 5147058623, label: "claim", note: "Can i work on this??" },
  { id: 5668149758, label: "claim", note: "I'd be interested in working on this if it's still available" },

  // sugarlabs/musicblocks-v4#796
  { id: 5682514727, label: "ambiguous", note: "maintainer: @prx-my assigning this to you" },
  { id: 5684749407, label: "claim", note: "sure on it" },
  { id: 5685475731, label: "claim", note: "im currently working on it" },
  { id: 5686690535, label: "ambiguous", note: "progress update from the claimant" },
  { id: 5698390901, label: "ambiguous", note: "progress update from the claimant" },
  { id: 5698494532, label: "ambiguous", note: "progress update from the claimant" },
  { id: 5734118866, label: "ambiguous", note: "progress update from the claimant" },
];
