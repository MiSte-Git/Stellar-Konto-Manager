/**
 * Scam-Simulator Szenarien
 *
 * Struktur pro Szenario:
 *
 * {
 *   id:         Eindeutige ID (kebab-case)
 *   category:   "fake-support" | "fake-website" | "fake-airdrop" | "romance-scam" | "fake-job"
 *   i18nKey:    Basis-Schlüssel im scamSimulator-Namespace (z.B. "scenarios.fakeSupport01")
 *
 *   contact: {
 *     nameKey:     i18n-Schlüssel für den Anzeigenamen des Absenders
 *     subtitleKey: i18n-Schlüssel für die Unterzeile (z.B. "Stellar Support Team")
 *     avatar:      Emoji oder Pfad zu einem Bild
 *     verified:    false → kein verifiziertes Häkchen im Chat-Header
 *   }
 *
 *   messages: Array von Chat-Nachrichten, sequenziell abgespielt:
 *   [
 *     {
 *       id:      Eindeutige Nachrichten-ID
 *       from:    "them"       → Nachricht des Gegenübers
 *               | "system"    → System-Hinweis (gelbe Pill, zentriert)
 *               | "decision"  → Entscheidungspunkt, zeigt Options-Buttons
 *       i18nKey: Schlüssel für den Nachrichtentext (bei from="them"/"system")
 *       delay:   Millisekunden Wartezeit vor Anzeige (simuliert Tipp-Pause)
 *       options: (nur bei from="decision") Überschreibt die Scenario-Optionen für
 *                diesen Entscheidungspunkt – ermöglicht mehrere Entscheidungsrunden
 *     }
 *   ]
 *
 *   options: Antwortoptionen, die beim ersten "decision"-Schritt angezeigt werden.
 *            Spätere decision-Einträge können eigene options definieren.
 *
 *   redFlags: Array von i18n-Schlüsseln – Warnsignale, die im Ergebnis-Screen erklärt werden
 *   explanationKey: i18n-Schlüssel für den erklärenden Abschlusstext
 * }
 */

const scenarios = [
  // ─────────────────────────────────────────────────────────────────────────────
  // SZENARIO 1: Fake Stellar Support – Secret Key Abfrage
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'fake-support-01',
    category: 'fake-support',
    i18nKey: 'scenarios.fakeSupport01',

    contact: {
      nameKey: 'scenarios.fakeSupport01.contact.name',
      subtitleKey: 'scenarios.fakeSupport01.contact.subtitle',
      avatar: '🌟',
      verified: false,
    },

    messages: [
      {
        id: 'msg-01',
        from: 'them',
        i18nKey: 'scenarios.fakeSupport01.messages.01',
        delay: 480,
      },
      {
        id: 'msg-02',
        from: 'them',
        i18nKey: 'scenarios.fakeSupport01.messages.02',
        delay: 1200,
      },
      {
        id: 'msg-03',
        from: 'them',
        i18nKey: 'scenarios.fakeSupport01.messages.03',
        delay: 900,
      },
      {
        id: 'decision-01',
        from: 'decision',
        delay: 0,
      },
    ],

    options: [
      {
        id: 'share-key',
        i18nKey: 'scenarios.fakeSupport01.options.shareKey',
        isScam: true,
        scamType: 'key-compromise',
        xp: -10,
        followUp: [
          {
            id: 'followup-scam-01',
            from: 'them',
            i18nKey: 'scenarios.fakeSupport01.followUp.scam.01',
            delay: 1200,
          },
          {
            id: 'followup-scam-02',
            from: 'them',
            i18nKey: 'scenarios.fakeSupport01.followUp.scam.02',
            delay: 1800,
          },
        ],
      },
      {
        id: 'ask-official',
        i18nKey: 'scenarios.fakeSupport01.options.askOfficial',
        isScam: false,
        xp: 5,
        followUp: [
          {
            id: 'followup-ask-01',
            from: 'them',
            i18nKey: 'scenarios.fakeSupport01.followUp.ask.01',
            delay: 1500,
          },
          {
            id: 'followup-decision-02',
            from: 'decision',
            delay: 0,
            options: [
              {
                id: 'share-key-2',
                i18nKey: 'scenarios.fakeSupport01.options.shareKey',
                isScam: true,
                scamType: 'key-compromise',
                xp: -10,
                followUp: [
                  {
                    id: 'followup-scam-01b',
                    from: 'them',
                    i18nKey: 'scenarios.fakeSupport01.followUp.scam.01',
                    delay: 1200,
                  },
                  {
                    id: 'followup-scam-02b',
                    from: 'them',
                    i18nKey: 'scenarios.fakeSupport01.followUp.scam.02',
                    delay: 1800,
                  },
                ],
              },
              {
                id: 'block-ignore-2',
                i18nKey: 'scenarios.fakeSupport01.options.blockIgnore',
                isScam: false,
                xp: 20,
                followUp: [],
              },
            ],
          },
        ],
      },
      {
        id: 'block-ignore',
        i18nKey: 'scenarios.fakeSupport01.options.blockIgnore',
        isScam: false,
        xp: 20,
        followUp: [],
      },
    ],

    redFlags: [
      'scenarios.fakeSupport01.redFlags.asksForKey',
      'scenarios.fakeSupport01.redFlags.urgency',
      'scenarios.fakeSupport01.redFlags.noVerification',
      'scenarios.fakeSupport01.redFlags.accountSuspension',
    ],

    explanationKey: 'scenarios.fakeSupport01.explanation',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // SZENARIO 2: Fake Website – Secret Key Phishing (Michaels Fall)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'fake-website-01',
    category: 'fake-website',
    i18nKey: 'scenarios.fakeWebsite01',

    contact: {
      nameKey: 'scenarios.fakeWebsite01.contact.name',
      subtitleKey: 'scenarios.fakeWebsite01.contact.subtitle',
      avatar: '🌐',
      verified: false,
    },

    messages: [
      {
        id: 'msg-01',
        from: 'them',
        i18nKey: 'scenarios.fakeWebsite01.messages.01',
        delay: 480,
      },
      {
        id: 'msg-02',
        from: 'them',
        i18nKey: 'scenarios.fakeWebsite01.messages.02',
        delay: 900,
      },
      {
        id: 'msg-03',
        from: 'them',
        i18nKey: 'scenarios.fakeWebsite01.messages.03',
        delay: 900,
      },
      {
        id: 'decision-01',
        from: 'decision',
        delay: 0,
      },
    ],

    options: [
      {
        id: 'enter-key',
        i18nKey: 'scenarios.fakeWebsite01.options.enterKey',
        isScam: true,
        scamType: 'key-compromise',
        xp: -10,
        followUp: [
          {
            id: 'followup-scam-01',
            from: 'them',
            i18nKey: 'scenarios.fakeWebsite01.followUp.scam.01',
            delay: 900,
          },
          {
            id: 'followup-scam-02',
            from: 'them',
            i18nKey: 'scenarios.fakeWebsite01.followUp.scam.02',
            delay: 900,
          },
          {
            id: 'followup-scam-03',
            from: 'system',
            i18nKey: 'scenarios.fakeWebsite01.followUp.scam.03',
            delay: 1200,
          },
        ],
      },
      {
        id: 'ask-why',
        i18nKey: 'scenarios.fakeWebsite01.options.askWhy',
        isScam: false,
        xp: 15,
        followUp: [
          {
            id: 'followup-ask-01',
            from: 'them',
            i18nKey: 'scenarios.fakeWebsite01.followUp.ask.01',
            delay: 900,
          },
          {
            id: 'followup-ask-02',
            from: 'them',
            i18nKey: 'scenarios.fakeWebsite01.followUp.ask.02',
            delay: 900,
          },
          {
            id: 'followup-ask-03',
            from: 'system',
            i18nKey: 'scenarios.fakeWebsite01.followUp.ask.03',
            delay: 900,
          },
        ],
      },
      {
        id: 'ignore-search',
        i18nKey: 'scenarios.fakeWebsite01.options.ignoreSearch',
        isScam: false,
        xp: 25,
        followUp: [],
      },
    ],

    redFlags: [
      'scenarios.fakeWebsite01.redFlags.targeted',
      'scenarios.fakeWebsite01.redFlags.websiteKey',
      'scenarios.fakeWebsite01.redFlags.fakeReviews',
    ],

    explanationKey: 'scenarios.fakeWebsite01.explanation',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // SZENARIO 3: Fake Airdrop – "Send XLM, get 10x back"
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'fake-airdrop-01',
    category: 'fake-airdrop',
    i18nKey: 'scenarios.fakeAirdrop01',

    contact: {
      nameKey: 'scenarios.fakeAirdrop01.contact.name',
      subtitleKey: 'scenarios.fakeAirdrop01.contact.subtitle',
      avatar: '🤖',
      verified: false,
    },

    messages: [
      {
        id: 'msg-01',
        from: 'them',
        i18nKey: 'scenarios.fakeAirdrop01.messages.01',
        delay: 480,
      },
      {
        id: 'msg-02',
        from: 'them',
        i18nKey: 'scenarios.fakeAirdrop01.messages.02',
        delay: 900,
      },
      {
        id: 'msg-03',
        from: 'them',
        i18nKey: 'scenarios.fakeAirdrop01.messages.03',
        delay: 900,
      },
      {
        id: 'decision-01',
        from: 'decision',
        delay: 0,
      },
    ],

    options: [
      {
        id: 'send-xlm',
        i18nKey: 'scenarios.fakeAirdrop01.options.sendXlm',
        isScam: true,
        scamType: 'xlm-sent',
        xp: -10,
        followUp: [
          {
            id: 'followup-scam-01',
            from: 'system',
            i18nKey: 'scenarios.fakeAirdrop01.followUp.scam.01',
            delay: 900,
          },
          {
            id: 'followup-scam-02',
            from: 'them',
            i18nKey: 'scenarios.fakeAirdrop01.followUp.scam.02',
            delay: 900,
          },
        ],
      },
      {
        id: 'too-good',
        i18nKey: 'scenarios.fakeAirdrop01.options.tooGood',
        isScam: false,
        xp: 20,
        followUp: [],
      },
      {
        id: 'check-official',
        i18nKey: 'scenarios.fakeAirdrop01.options.checkOfficial',
        isScam: false,
        xp: 25,
        followUp: [],
      },
    ],

    redFlags: [
      'scenarios.fakeAirdrop01.redFlags.sendToReceive',
      'scenarios.fakeAirdrop01.redFlags.timeLimit',
      'scenarios.fakeAirdrop01.redFlags.noSource',
    ],

    explanationKey: 'scenarios.fakeAirdrop01.explanation',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // SZENARIO 4: Romance Scam – Vertrauensaufbau und Geldanfrage
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'romance-scam-01',
    category: 'romance-scam',
    i18nKey: 'scenarios.romanceScam01',

    contact: {
      nameKey: 'scenarios.romanceScam01.contact.name',
      subtitleKey: 'scenarios.romanceScam01.contact.subtitle',
      avatar: '😊',
      verified: false,
    },

    messages: [
      {
        id: 'msg-01',
        from: 'them',
        i18nKey: 'scenarios.romanceScam01.messages.01',
        delay: 480,
      },
      {
        id: 'msg-02',
        from: 'them',
        i18nKey: 'scenarios.romanceScam01.messages.02',
        delay: 1200,
      },
      {
        id: 'msg-03',
        from: 'them',
        i18nKey: 'scenarios.romanceScam01.messages.03',
        delay: 900,
      },
      {
        id: 'decision-01',
        from: 'decision',
        delay: 0,
      },
    ],

    options: [
      {
        id: 'send-xlm',
        i18nKey: 'scenarios.romanceScam01.options.sendXlm',
        isScam: true,
        scamType: 'xlm-sent',
        xp: -10,
        followUp: [
          {
            id: 'followup-scam-01',
            from: 'them',
            i18nKey: 'scenarios.romanceScam01.followUp.scam.01',
            delay: 900,
          },
          {
            id: 'followup-scam-02',
            from: 'system',
            i18nKey: 'scenarios.romanceScam01.followUp.scam.02',
            delay: 1200,
          },
        ],
      },
      {
        id: 'ask-video-call',
        i18nKey: 'scenarios.romanceScam01.options.askVideoCall',
        isScam: false,
        xp: 15,
        followUp: [
          {
            id: 'followup-ask-01',
            from: 'them',
            i18nKey: 'scenarios.romanceScam01.followUp.ask.01',
            delay: 900,
          },
          {
            id: 'followup-ask-02',
            from: 'them',
            i18nKey: 'scenarios.romanceScam01.followUp.ask.02',
            delay: 900,
          },
          {
            id: 'followup-ask-03',
            from: 'system',
            i18nKey: 'scenarios.romanceScam01.followUp.ask.03',
            delay: 900,
          },
        ],
      },
      {
        id: 'no-to-stranger',
        i18nKey: 'scenarios.romanceScam01.options.noToStranger',
        isScam: false,
        xp: 25,
        followUp: [],
      },
    ],

    redFlags: [
      'scenarios.romanceScam01.redFlags.emotionalPressure',
      'scenarios.romanceScam01.redFlags.stranded',
      'scenarios.romanceScam01.redFlags.noVideoCall',
      'scenarios.romanceScam01.redFlags.promisedRepayment',
    ],

    explanationKey: 'scenarios.romanceScam01.explanation',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // SZENARIO 5: Fake Job – Kaution als Einstiegshürde
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'fake-job-01',
    category: 'fake-job',
    i18nKey: 'scenarios.fakeJob01',

    contact: {
      nameKey: 'scenarios.fakeJob01.contact.name',
      subtitleKey: 'scenarios.fakeJob01.contact.subtitle',
      avatar: '💼',
      verified: false,
    },

    messages: [
      {
        id: 'msg-01',
        from: 'them',
        i18nKey: 'scenarios.fakeJob01.messages.01',
        delay: 480,
      },
      {
        id: 'msg-02',
        from: 'them',
        i18nKey: 'scenarios.fakeJob01.messages.02',
        delay: 1200,
      },
      {
        id: 'msg-03',
        from: 'them',
        i18nKey: 'scenarios.fakeJob01.messages.03',
        delay: 900,
      },
      {
        id: 'decision-01',
        from: 'decision',
        delay: 0,
      },
    ],

    options: [
      {
        id: 'send-deposit',
        i18nKey: 'scenarios.fakeJob01.options.sendDeposit',
        isScam: true,
        scamType: 'xlm-sent',
        xp: -10,
        followUp: [
          {
            id: 'followup-scam-01',
            from: 'them',
            i18nKey: 'scenarios.fakeJob01.followUp.scam.01',
            delay: 900,
          },
          {
            id: 'followup-scam-02',
            from: 'system',
            i18nKey: 'scenarios.fakeJob01.followUp.scam.02',
            delay: 1200,
          },
        ],
      },
      {
        id: 'no-caution',
        i18nKey: 'scenarios.fakeJob01.options.noCaution',
        isScam: false,
        xp: 20,
        followUp: [],
      },
      {
        id: 'research-first',
        i18nKey: 'scenarios.fakeJob01.options.researchFirst',
        isScam: false,
        xp: 25,
        followUp: [],
      },
    ],

    redFlags: [
      'scenarios.fakeJob01.redFlags.depositRequired',
      'scenarios.fakeJob01.redFlags.cryptoPayment',
      'scenarios.fakeJob01.redFlags.limitedSpots',
    ],

    explanationKey: 'scenarios.fakeJob01.explanation',
  },
  // ─────────────────────────────────────────────────────────────────────────────
  // SZENARIO 6: Fake Cashback – Zu gut um wahr zu sein
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'fake-cashback',
    category: 'fake-airdrop',
    i18nKey: 'scenarios.fakeCashback',

    contact: {
      nameKey: 'scenarios.fakeCashback.contact.name',
      subtitleKey: 'scenarios.fakeCashback.contact.subtitle',
      avatar: '🛒',
      verified: false,
    },

    messages: [
      {
        id: 'msg-01',
        from: 'them',
        i18nKey: 'scenarios.fakeCashback.messages.01',
        delay: 480,
      },
      {
        id: 'msg-02',
        from: 'them',
        i18nKey: 'scenarios.fakeCashback.messages.02',
        delay: 1200,
      },
      {
        id: 'msg-03',
        from: 'system',
        i18nKey: 'scenarios.fakeCashback.messages.03',
        delay: 900,
      },
      {
        id: 'decision-01',
        from: 'decision',
        delay: 0,
      },
    ],

    options: [
      {
        id: 'nothing-suspicious',
        i18nKey: 'scenarios.fakeCashback.options.nothingSuspicious',
        isScam: true,
        scamType: 'xlm-sent',
        xp: -10,
        followUp: [
          {
            id: 'followup-scam-01',
            from: 'them',
            i18nKey: 'scenarios.fakeCashback.followUp.scam.01',
            delay: 900,
          },
          {
            id: 'followup-scam-02',
            from: 'system',
            i18nKey: 'scenarios.fakeCashback.followUp.scam.02',
            delay: 1200,
          },
        ],
      },
      {
        id: 'too-generous',
        i18nKey: 'scenarios.fakeCashback.options.tooGenerous',
        isScam: false,
        xp: 10,
        followUp: [
          {
            id: 'followup-gen-01',
            from: 'them',
            i18nKey: 'scenarios.fakeCashback.followUp.generous.01',
            delay: 900,
          },
          {
            id: 'followup-gen-02',
            from: 'system',
            i18nKey: 'scenarios.fakeCashback.followUp.generous.02',
            delay: 1500,
          },
          {
            id: 'decision-02',
            from: 'decision',
            delay: 0,
            options: [
              {
                id: 'add-anyway',
                i18nKey: 'scenarios.fakeCashback.options.addAnyway',
                isScam: true,
                scamType: 'xlm-sent',
                xp: -10,
                followUp: [
                  {
                    id: 'followup-add-01',
                    from: 'them',
                    i18nKey: 'scenarios.fakeCashback.followUp.addAnyway.01',
                    delay: 900,
                  },
                  {
                    id: 'followup-add-02',
                    from: 'system',
                    i18nKey: 'scenarios.fakeCashback.followUp.addAnyway.02',
                    delay: 1200,
                  },
                ],
              },
              {
                id: 'reject-verify',
                i18nKey: 'scenarios.fakeCashback.options.rejectVerify',
                isScam: false,
                xp: 20,
                followUp: [],
              },
              {
                id: 'buy-dex',
                i18nKey: 'scenarios.fakeCashback.options.buyDex',
                isScam: true,
                scamType: 'xlm-sent',
                xp: -10,
                followUp: [
                  {
                    id: 'followup-dex-01',
                    from: 'system',
                    i18nKey: 'scenarios.fakeCashback.followUp.buyDex.01',
                    delay: 1200,
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: 'check-issuer',
        i18nKey: 'scenarios.fakeCashback.options.checkIssuer',
        isScam: false,
        xp: 25,
        followUp: [
          {
            id: 'followup-issuer-01',
            from: 'system',
            i18nKey: 'scenarios.fakeCashback.followUp.issuer.01',
            delay: 900,
          },
          {
            id: 'followup-issuer-02',
            from: 'system',
            i18nKey: 'scenarios.fakeCashback.followUp.issuer.02',
            delay: 1500,
          },
          {
            id: 'decision-02b',
            from: 'decision',
            delay: 0,
            options: [
              {
                id: 'add-anyway-2',
                i18nKey: 'scenarios.fakeCashback.options.addAnyway',
                isScam: true,
                scamType: 'xlm-sent',
                xp: -10,
                followUp: [
                  {
                    id: 'followup-add-01b',
                    from: 'them',
                    i18nKey: 'scenarios.fakeCashback.followUp.addAnyway.01',
                    delay: 900,
                  },
                  {
                    id: 'followup-add-02b',
                    from: 'system',
                    i18nKey: 'scenarios.fakeCashback.followUp.addAnyway.02',
                    delay: 1200,
                  },
                ],
              },
              {
                id: 'reject-verify-2',
                i18nKey: 'scenarios.fakeCashback.options.rejectVerify',
                isScam: false,
                xp: 20,
                followUp: [],
              },
              {
                id: 'buy-dex-2',
                i18nKey: 'scenarios.fakeCashback.options.buyDex',
                isScam: true,
                scamType: 'xlm-sent',
                xp: -10,
                followUp: [
                  {
                    id: 'followup-dex-01b',
                    from: 'system',
                    i18nKey: 'scenarios.fakeCashback.followUp.buyDex.01',
                    delay: 1200,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],

    redFlags: [
      'scenarios.fakeCashback.redFlags.freeTokens',
      'scenarios.fakeCashback.redFlags.fakeIssuer',
      'scenarios.fakeCashback.redFlags.urgency',
      'scenarios.fakeCashback.redFlags.sameNameDifferentIssuer',
    ],

    explanationKey: 'scenarios.fakeCashback.explanation',
  },
];

export default scenarios;
