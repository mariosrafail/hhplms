# Current Unit Extras και full-book Prepare — περιορισμένη συνέχεια

Αφετηρία: `e4b7ac50e410de592117c3de49e91e360fd873b9`, tree `834f1796d4e40ac9630b96e5a2ca8966fee1fb51`. Διατηρούνται τα commits `d249778f37a1d830a4b156d593b4aea972f4c265` και `e4b7ac50e410de592117c3de49e91e360fd873b9`. Το fetched `origin/dev` κατά την έναρξη ήταν `fff347cceb86f47489130cd6c2d49a7e64d2af55`. Η συνέχεια δεν εξουσιοδοτεί push, hosted migration/publication, shared DB/R2 ή ανάγνωση secrets.

## Current Extras contract

Το reviewed code απέρριπτε page-level visibility για canonical Unit 3 και managed Unit 10 μέσω του ιστορικού καταλόγου Units 1–2. Τα νέα regression tests καταγράφηκαν πρώτα ως red με τους πραγματικούς save handlers. Αυτό δεν αποτελεί ισχυρισμό ότι κάθε Unit-level upload ήταν αποτυχημένο.

Το `unitExtras.js` μοιράζεται τα υπάρχοντα media validation primitives ανάμεσα σε historical normalization και current structural validation. Ο current validator επιστρέφει αντίγραφο του raw authored document, αφού ελέγξει τη δομή του. Δεν προσθέτει audio defaults, δεν ταξινομεί Units/pages και δεν ξαναγράφει τίτλους ή άλλα πεδία στον αποθηκευμένο payload. Οι historical v1/v2 readers συνεχίζουν να χρησιμοποιούν τον ιστορικό κατάλογο. Τα immutable v3 releases ελέγχουν το captured page contract, χωρίς current DB lookups.

Ο server resolver `_students-book-current-extras.js` ελέγχει κάθε πραγματικό setting απέναντι στην κοινή Students Book page authority. Active και valid retained/deleted pages αναγνωρίζονται χωριστά. Unknown/foreign pages ή λανθασμένη Unit απορρίπτονται· δεν αντιμετωπίζονται ως dormant. Τα dormant settings παραμένουν στο raw document και στο checksum του, αλλά αποκλείονται από την active projection. Το restore τα επαναφέρει μέσω της υπάρχουσας page lifecycle πολιτικής.

Το stored checksum/schema/revision ελέγχεται πριν από οποιαδήποτε current projection. Draft read, generic content save, dedicated Extras save, Saved Draft preview και v3 source collection χρησιμοποιούν τα κατάλληλα current context checks. Το generic save ελέγχει επίσης asset ownership, όπως το dedicated endpoint. Η compilation ελέγχει και τα πραγματικά dormant settings πριν τα αποκλείσει από τη δημοσίευση. Καμία read/preview/Prepare ενέργεια δεν εκτελεί authored save.

Ο editor διαβάζει το κοινό Page Library API και εμφανίζει IDs, active membership και labels για την επιλεγμένη Unit. Δεν φορτώνει activity payloads ή media bytes για αυτή τη λίστα. Η φόρτωση του document και του catalog ολοκληρώνεται ως ενιαία έγκυρη κατάσταση. Αποτυχημένη φόρτωση δεν δημιουργεί έγκυρο κενό draft προς save. Abort/generation checks αποτρέπουν stale read/save/upload responses μετά από αλλαγή επιλογής. Deliberate edits διατηρούν τις άλλες Units, dormant settings, media IDs/slots, metadata, cues και την απουσία optional audio fields.

## Νέα acceptance gates

- `npm test`: current structural/context/raw checksum regressions, μαζί με τα προηγούμενα historical και v3 tests.
- `npm run test:integration`: πραγματικοί Extras handlers με isolated PostgreSQL, MP3/MP4 prepare/finalize/attach, U3/U10 visibility, Saved Draft, Prepare/Publish, stale/replay/ownership/malformed outcomes, dormant delete/restore· ξεχωριστό full-book Prepare test.
- `npm run test:builder:extras`: πραγματικό `UnitExtrasEditor`, API clients και LMS media components σε test-only React mount, με τους πραγματικούς PostgreSQL handlers. Ελέγχει επιλογή flags, save/reload/preview, failed reads/saves/uploads και stale selection response. Το test mount και το preview context adapter δεν εισάγονται σε production bundles. Η preview authorization του synthetic mount αποτελεί ρητό test boundary· οι προηγούμενοι authorization gates διατηρούνται.
- `npm run test:students-book:fullbook-worker`: πραγματικός production materializer και `CloudflareR2ReleaseStorage` σε local workerd, με local ASSETS/R2 bindings. Συνδέεται στο unit-and-build job. Το Extras browser gate συνδέεται στο integration-database job και εκτελείται σειριακά μετά τις άλλες DB δοκιμές.

Τα νέα tests δεν αντικαθιστούν το μικρό functional unification E2E, τα all-book preservation comparisons, τα historical combined/Unit Extras fixtures ή τα Student/Teacher/assignment/offline/APK gates.

## Full-book inputs και boundaries

Το πραγματικό manifest περιέχει **110 διαφορετικές canonical εικόνες**, συνολικά **55.678.468 bytes**, με μεγαλύτερη εικόνα **1.234.247 bytes**. Η acceptance επιβεβαιώνει ότι κάθε input είναι tracked και επαληθεύει SHA, MIME, byte size και dimensions. Δεν δημιουργεί 110 αντίγραφα της ίδιας synthetic εικόνας. Τα publisher inputs χρησιμοποιούνται μόνο ως read-only test inputs και αποκλείονται από το review package.

Το επίπεδο PostgreSQL εκτελεί τον πραγματικό Prepare handler, collector, compiler, pin verification και SQL persistence. Το cold case κρατά και τις 110 canonical εικόνες, μία synthetic native activity, δύο synthetic media assets/pins, ένα synthetic Teacher UI asset και τρία product members. Η canonical destination storage είναι αρχικά κενή και αποθηκεύεται σε task-owned προσωρινά αρχεία. Πρόσθετο R2 σενάριο προσθέτει managed σελίδα και αντικαθιστά canonical εικόνα μετά το R1. Η παλιά ανάθεση και τα verified R1 bytes παραμένουν αναγνώσιμα.

Το επίπεδο Workers εκτελεί τον ίδιο production materializer και R2 adapter σε τοπικό workerd. Χρησιμοποιεί την έκδοση Miniflare που συνοδεύει το pinned Wrangler και τον διαθέσιμο `convertV4MiniflareOptions` compatibility helper. Το ASSETS directory περιέχει read-only links στα tracked inputs. Τα R2 bindings είναι αποκλειστικά τοπικά. Test-only namespaces επιτρέπουν ανεξάρτητα cold failure/concurrency σενάρια. Κάθε unexpected outbound request απορρίπτεται από το harness. Δεν υπάρχει Worker DB adapter: ο πραγματικός SQL μηχανισμός καλύπτεται χωριστά στο πρώτο επίπεδο.

Καλύπτονται cold materialization, ίδιο mutation, νέο Prepare/reuse, δύο concurrent cold attempts, corrupt bytes με σωστά metadata, αλλοιωμένα metadata/size, failures στα assets 1/55/110, ασφαλές retry και source/page/Extras saves κατά το Prepare. Οι failures δεν αλλάζουν publication head και δεν δημιουργούν incomplete ready candidate. Τα ήδη δημιουργημένα objects δεν αναιρούνται από SQL rollback: παραμένουν στο isolated content-addressed namespace και επαναχρησιμοποιούνται μετά από πλήρη verification. Δεν προστίθεται orphan cleanup.

Ο production materializer παραμένει αμετάβλητος. Κάθε πλήρες pass εκτελεί **110 ASSETS fetches, 110 PUT attempts, 220 HEAD και 110 GET**, με **55.678.468 readback bytes**. Στο reuse τα PUT παραμένουν create-only attempts και δεν αντικαθιστούν objects. Η ακολουθία περιορίζει τη δουλειά σε μία canonical εικόνα ανά request. Δύο ταυτόχρονα requests έχουν δύο τέτοιες ανεξάρτητες ακολουθίες. Η assertion αφορά in-flight asset work, όχι measured peak isolate memory ή χρόνο GC.

## Μετρήσεις και hosted resource budget

Τα JSON metrics καταγράφουν κάθε scenario, operation counts και wall time. Το Node επίπεδο καταγράφει SQL statement count, χρόνο πριν από materialization, materialization, pin verification, SQL create και συνολικό request, μαζί με `process.cpuUsage()` deltas και `process.resourceUsage().maxRSS`. Το maxRSS είναι process-lifetime peak που περιλαμβάνει setup· δεν αποτελεί μέτρηση Worker isolate.

Το Worker επίπεδο καταγράφει request wall time, Node harness CPU/RSS και, σε Linux όπου υπάρχει child PID, workerd process CPU μέσω `/proc/<pid>/stat` (`utime + stime`, `CLK_TCK`) και peak RSS μέσω `VmHWM`. Αυτά περιλαμβάνουν local binding simulators και πολλαπλά isolates. Τα concurrent CPU samples επικαλύπτονται και δεν αθροίζονται. **Per-request isolate CPU και peak isolate memory: not measured**, επειδή το harness δεν εκθέτει αξιόπιστους αντίστοιχους counters. Δεν μετατρέπεται το compressed image size σε υποτιθέμενο peak isolate memory.

Πριν από οποιαδήποτε performance αλλαγή μετρήθηκε η υπάρχουσα διαδρομή. Το πρώτο local Worker cold pass ήταν περίπου 2,39 s· οι development επαναλήψεις διαφέρουν με το φορτίο του υπολογιστή. Η ελεγχόμενη καθυστέρηση 2 ms ανά binding operation είναι **local latency simulation**, όχι hosted Neon/R2 μέτρηση. Δεν υπάρχει αυθαίρετο wall-time CI threshold ή αύξηση production limits/timeouts. Τα τελικά exact-candidate metrics παραδίδονται εξωτερικά μετά τη fresh-checkout validation.

Official documentation, πρόσβαση **2026-09-07**:

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/): 128 MB ανά isolate, έξι ταυτόχρονες outgoing connections. Free HTTP CPU 10 ms· Paid default 30 s, δυνατότητα έως 5 min. External subrequests 50 Free / default 10.000 Paid, internal services 1.000 Free / configured Paid limit. Static asset όριο 25 MiB ανά αρχείο.
- [Local development](https://developers.cloudflare.com/workers/local-development/): Miniflare χρησιμοποιεί workerd, με τοπικά simulated bindings εξ ορισμού.
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/): local development R2 operations αφορούν τοπική storage· remote bindings απαιτούν χωριστή ενεργοποίηση, που δεν χρησιμοποιείται εδώ.

| Hosted περίπτωση | Τι τεκμηριώνεται τοπικά | Τι απομένει |
| --- | --- | --- |
| Workers Free | 440 R2 binding operations ανά πλήρες canonical pass, bounded sequential work, κάθε εικόνα κάτω από 25 MiB | Δεν έχει επαληθευτεί το CPU budget 10 ms ή το isolate peak· τα process counters δεν αποδεικνύουν Free compatibility. Χρειάζεται έλεγχος συνολικών external/internal subrequests του πλήρους hosted graph. |
| Workers Paid | Η local διαδρομή ολοκληρώνει full-book verification, reuse και failures με τα καταγεγραμμένα counts | Επιβεβαίωση πραγματικού plan/config, hosted CPU/isolate memory και DB/R2 latency. Το local result δεν αντικαθιστά staging acceptance. |
| Άγνωστο plan | Δεν εμποδίζει τα local functional/resource-count gates | Κανένα account/API lookup δεν έγινε. Δεν υπάρχει εξουσιοδότηση για hosted probe ή rollout. |

## CI Risk / Derived-State Check

| Boundary | Αλλαγή / διατήρηση | Gate |
| --- | --- | --- |
| Current Extras structure/context | Shared primitives, raw persisted identity, authoritative active/retained membership | New unit, PostgreSQL και browser tests |
| Projection/freshness | Dormant filtering μετά από ownership validation· captured v3 verification παραμένει ανεξάρτητη | v3 tests, source/page/Extras concurrent saves, R1/R2 |
| Historical identity | AUTHORING_UNITS, v1/v2 fixtures, absent/explicit-empty audio και focusLayout contracts αμετάβλητα | Historical immutable tests και υπάρχοντα bundle/offline gates |
| Migrations/runtime | Καμία SQL/generator/generated hash αλλαγή | Manifest verification, runtime audit, πραγματικό migration/preservation integration |
| Worker graph/static assets | Ένας current server resolver· test-only entries δεν εισάγονται στα production Workers | Builder/LMS canonical build/dry-run verifiers, graph και bundle safety |
| All-book preservation | Καμία operational διαγραφή ή επανεγγραφή protected περιεχομένου | Υπάρχον all-book preservation harness, πλήρης integration ακολουθία |

Η fresh-checkout validation πρέπει να αρχίζει με Node 22 και ακριβώς `npm ci` → `npm run verify:migration-manifest` → `npm run audit:runtime-schema-boundary` → `npm test`, πριν από builds/generators. Ακολουθούν τα actual CI gates, τα νέα tests, PostgreSQL/published assignments, Cloudflare και τα τρία πραγματικά APK gates. Το external final report συνδέει exit codes/log hashes με το τελικό SHA/tree. Οι παλιές 50 επιτυχείς εντολές αποτελούν μόνο baseline evidence.

## Διόρθωση checksum 061

Οι παρακάτω τιμές υπολογίστηκαν με `migrationChecksums` από `scripts/_migration-readiness.mjs`, όχι με αντιγραφή expected literals:

| Migration | Canonical LF SHA-256 | Compatible CRLF SHA-256 |
| --- | --- | --- |
| 060 | `29fbe7121befc89669ebb3caf837169d907bfbcc9d1ef409a768e6bf7557cc17` | `b29aab4fdf5d8721347d198f865ccc0dd59c1798903d34ef9ca28e2a9cc08a91` |
| 061 | `ed2d4491a605c370aff6e75e807cc9f734ac79c06b415b519e291e0a1d573079` | `c66900f1f5217310e75f01cc699da37562299d5430a4b552b2da753679a30369` |

Στο starting workspace τα actual file-byte hashes είναι ίδια με τα canonical LF hashes. Το final checkout καταγράφεται χωριστά επειδή το newline convention μπορεί να διαφέρει ανά checkout. Το manifest/runtime fingerprint παραμένει `9979f39fc082f70942bbf8bb6420089cfc298f89512b218affe72a015f53e942`, με 61 migrations. Το προηγούμενο report ονόμασε εσφαλμένα το CRLF checksum της 061 canonical. Τα παλιά evidence παραμένουν αμετάβλητα· η διόρθωση δεν απαιτεί νέα migration.

## Όρια παράδοσης

Το νέο external ZIP περιέχει πλήρη task-owned sources/tests/docs, baseline-to-final και continuation-only patches, candidate metadata, inventory/checksums, sanitized logs/metrics και μόνο synthetic screenshots. Αποκλείονται publisher media, dumps, credentials/connection strings, dependencies, build outputs, APKs και unrelated εργασία.

**NOT PUSHED.** Remote CI: **Not run: intentionally not pushed.** Repository correctness κρίνεται από τη νέα exact-candidate validation. Hosted/staging acceptance και actual production operational readiness παραμένουν χωριστές μελλοντικές αποφάσεις, με νέα live all-book inventory, restore-capable backups/rehearsal, hosted resource budget και ρητά εγκεκριμένη rollout σειρά.
