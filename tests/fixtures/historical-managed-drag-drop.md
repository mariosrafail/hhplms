# Frozen historical managed Drag & Drop releases

**Do not regenerate with the current compiler.** These are synthetic repository-only artifacts, not operational release rows. No DB, publisher content, credentials, media bytes or real object keys were used.

Reproduction: extract each exact Git commit below into a fresh directory; copy only `tests/fixtures/managed-drag-drop.js` from this change into that checkout. Import that checkout's `compileUltimateB2ManagedComponentRelease`, `verifyUltimateB2ManagedComponentRelease`, and the synthetic helper. For each component, compile `managedDragDropSources(component, options)`, convert with `managedDragDropReleaseRow`, verify with the same historical compiler, and freeze JSON.stringify(row, null, 2) + LF. Options: original `{font:false,multiline:false}`; presentation `{font:true,multiline:false}`; multiline and rich `{font:true,multiline:true}`. Never run the current compiler to update these files. All eight artifacts passed their originating verifier before they were frozen.

## Repository audit and finite profiles

- Managed publication introduction: `471b77e51cf2f5fd1dfe95d6b14f01dcd2921a5b`. The original Drag & Drop contract existed throughout this managed era; immutable source pins at `d7c58ff2b08a9f17cf40145a1723ca2311287f14` provide the original frozen anchor.
- `e8be98598d86ee7537ff671e53405c95be2ce9ff` added interaction helpers, not canonical fields. No new profile.
- `8d2c3c2203314abbcd01e99ac3480cd8a21fbbf9` added canonical presentation and font liveness. This needs the presentation profile. The fixtures exercise a managed font and nondefault styles.
- `8fc76b61c7f6d1566ecc012b9e59ca65f3d3ca28` allowed safe multiline word/instruction text. Valid earlier canonical single-line values remain byte-identical. Multiline is covered by the presentation profile, with separate frozen artifacts proving its additional valid value domain. Original pre-presentation words, metadata and image descriptions remain single-line.
- `12e5535805403d9a5f9f0466ca1911731f8d5f9d` added reusable, shortLabel, target capacity, layout fields and Teacher wordIds. Its frozen releases verify using CURRENT, with no historical transformation.
- `f0acf6a944f9839a04d546ae18e2ba76bba65ad9` relaxed reusable text-layout topology; it did not change older canonical output. No profile.
- `52a973392ea210168df4706fe27849fb745378c6` added optional raster word images, emitted only when supplied. Older rich output remains identical. No profile.
- Later multi-part / Teacher image work at `2afb69a144e3e9fa53006b723984092b19ddc022` uses the existing composition compatibility marker where applicable; no further Drag & Drop normalizer change exists through baseline `85a99c5a9138ba0c7c0f5bd082ce257b4910534f`.
- Generic public optional supporting content changes emit only when supplied; old omissions stay omitted. Historical profiles admit only the historical public wrapper fields. Current optional supplemental audio / item images are not admitted as legacy input.

All four frozen anchors share the same per-component managed compatibility for the kind set containing only Drag & Drop. No current compiler ID, schema, compatibility formula, authoring normalizer or runtime is changed. Historical helpers use current invariant validation followed by an explicit historical projection; canonical equality and every original manifest/hash check are mandatory. Profile selection is release-wide and accepts exactly one match. Mixed partial defaults and mixed Teacher/public epochs fail closed, including with recomputed hashes.

## Frozen identities

Canonical artifact SHA-256 uses `builderDocumentSha256(row)` (stable sorted-key JSON); file SHA-256 pins the exact UTF-8 LF file. Source/public/Teacher/aggregate hashes were emitted by the historical compiler, independently of the new verifier.

### historical-managed-drag-drop-original-grammar.json

- commit: `d7c58ff2b08a9f17cf40145a1723ca2311287f14`
- component: `ultimate-b2-grammar-book`
- compiler: `ultimate-b2-grammar-book-v1`
- epoch: `original`
- compatibility: `1f3a87e55ae63999702b645e440b3dc49958caf33068ee7cbf4dc5a0cb14a5cd`
- source: `dda30f92b15bd6c2a9b298abe571c6e4887d13ee79386d8d34055b6c93ca7446`
- public: `90f85c412aa8bac33a4055bf2d95b1f2d7d2f9577a34d7000c34dcf5fbdea40f`
- teacher: `016112bcdf70c1c6e4df2cc000aee0aefe8c3d620025c67bbd2ab52407092056`
- release: `0c86bd9de9640b40835eba124726ad541691cfb9b799adf278883587e1c06344`
- canonicalArtifactSha256: `1fbb5a28c7c8218d4338d63f7872a4b521e6eeca9ca5618a5cf3005af969a0bd`
- historicalVerify: `True`
- fileSha256: `3db2b632eec8f3a43edd0eb96477df54ee619d24e70959b083786d697bf47182`

### historical-managed-drag-drop-original-workbook.json

- commit: `d7c58ff2b08a9f17cf40145a1723ca2311287f14`
- component: `ultimate-b2-workbook`
- compiler: `ultimate-b2-workbook-v1`
- epoch: `original`
- compatibility: `6f25da8e2c53085bb80d6507709ca9bb9658fdd077d074f05eef3fb83ee7c6ab`
- source: `7a0efd68f4aa68f0e6bed05869881458fd1b0078d3ca174233546797eca7f046`
- public: `1979f33d2337c2ca5f59a35e190b63781810e6f5598c65551dab47912decfcbe`
- teacher: `0f05af416b8b2c3a33833066d80169d5919f60267115c2ac805a1f225e0a0005`
- release: `7a5b8d0ad5a9e9198356bdcf4139d25f36fb77e2f4dd48b195a1805d0073cf94`
- canonicalArtifactSha256: `c90e6e2770d161ef27b71cc459bc73b7248803c2b81bb7decef2ff64dad12e30`
- historicalVerify: `True`
- fileSha256: `f3b9f02777645ebc00d15f3e786f56926ad77d189c9ff54bb1c241763d487367`

### historical-managed-drag-drop-presentation-grammar.json

- commit: `8d2c3c2203314abbcd01e99ac3480cd8a21fbbf9`
- component: `ultimate-b2-grammar-book`
- compiler: `ultimate-b2-grammar-book-v1`
- epoch: `presentation`
- compatibility: `1f3a87e55ae63999702b645e440b3dc49958caf33068ee7cbf4dc5a0cb14a5cd`
- source: `15d053785e5aba62959bd53094206c752188b474c0aa9eb5153b311198f3fbf8`
- public: `9703102de04926fa322e0e12911c1dfb22efcd9f8e6cbba6c79c3c6516f6426e`
- teacher: `016112bcdf70c1c6e4df2cc000aee0aefe8c3d620025c67bbd2ab52407092056`
- release: `104070bdb50de60f877147caa264e7e30ef29098a567e6698de9352e1eaad2d1`
- canonicalArtifactSha256: `5e01d49aaf218e640bfff3da5c121c03875851876b964dc5f28246ae556d8ca2`
- historicalVerify: `True`
- fileSha256: `7fb1947cf307467931fd79887aef46b1766af3464101d28516519f966548b665`

### historical-managed-drag-drop-presentation-workbook.json

- commit: `8d2c3c2203314abbcd01e99ac3480cd8a21fbbf9`
- component: `ultimate-b2-workbook`
- compiler: `ultimate-b2-workbook-v1`
- epoch: `presentation`
- compatibility: `6f25da8e2c53085bb80d6507709ca9bb9658fdd077d074f05eef3fb83ee7c6ab`
- source: `a8b4cb8a2a7705d2c272c169badea1b5cb7c8091a6f527f1609ed4e9e8fc4a20`
- public: `686887d85c04b1100b57d4489c91340ac63c9720370d0806a8eaba07a93256ec`
- teacher: `0f05af416b8b2c3a33833066d80169d5919f60267115c2ac805a1f225e0a0005`
- release: `60ba732e648a13078cc277c0822c7640284a81c154227a6feb4e3c2d1f78b6a9`
- canonicalArtifactSha256: `ba05d19cc91c8c22e2fca89d1b6424a5790cb71b10bcb3a99f9907d1cd848a86`
- historicalVerify: `True`
- fileSha256: `936fea4ac9230abe06351f5fe65610b6af0144527a7fdda8baaa52ad525f9696`

### historical-managed-drag-drop-multiline-grammar.json

- commit: `8fc76b61c7f6d1566ecc012b9e59ca65f3d3ca28`
- component: `ultimate-b2-grammar-book`
- compiler: `ultimate-b2-grammar-book-v1`
- epoch: `multiline`
- compatibility: `1f3a87e55ae63999702b645e440b3dc49958caf33068ee7cbf4dc5a0cb14a5cd`
- source: `fbfd70d80f22881b895459074d2ac2ee53d79570e0b0d244e408ca6a84213f8c`
- public: `0bbff8681faf270b0197ca70391439912f42129419fd523a583f6124ed7017b7`
- teacher: `016112bcdf70c1c6e4df2cc000aee0aefe8c3d620025c67bbd2ab52407092056`
- release: `da76b32dee03443978cc0a9ce6c97d31562700d7f86e42240f9b681a7aad283e`
- canonicalArtifactSha256: `9493f38068b82b00faef453dcc2a74d1c7ac771106ea472893e85ed8ccae43c6`
- historicalVerify: `True`
- fileSha256: `cdef470f12bc8e690b82833cf486c443c8165c13e2df6eab302939c065b5a9d6`

### historical-managed-drag-drop-multiline-workbook.json

- commit: `8fc76b61c7f6d1566ecc012b9e59ca65f3d3ca28`
- component: `ultimate-b2-workbook`
- compiler: `ultimate-b2-workbook-v1`
- epoch: `multiline`
- compatibility: `6f25da8e2c53085bb80d6507709ca9bb9658fdd077d074f05eef3fb83ee7c6ab`
- source: `228403b0dc385942cfbad01b77008efe3943e7f5c31f7fdcced1d7394d64d9d6`
- public: `f83205efa404c99df28264cc9fc396b179cbe1369325e4f6c9e39b8fa7431268`
- teacher: `0f05af416b8b2c3a33833066d80169d5919f60267115c2ac805a1f225e0a0005`
- release: `c212d7f19600f6ee3dd7b6b3d4f172e05f80237ba641e54635bc43806b2715ce`
- canonicalArtifactSha256: `c48d6cc5c61908ed8b35d232fbf60c2088825ef9a022a00bad4dc7b5afefcc6a`
- historicalVerify: `True`
- fileSha256: `2401ef50fff80873e894a8bdda7d10b55baf056367cbafb9025ac7244e669730`

### historical-managed-drag-drop-rich-grammar.json

- commit: `12e5535805403d9a5f9f0466ca1911731f8d5f9d`
- component: `ultimate-b2-grammar-book`
- compiler: `ultimate-b2-grammar-book-v1`
- epoch: `rich`
- compatibility: `1f3a87e55ae63999702b645e440b3dc49958caf33068ee7cbf4dc5a0cb14a5cd`
- source: `e46a52039b4cdf30f30aaa7d238b20b8ffb4f4cec8bc4e6533a5f0a48af7cd43`
- public: `ef55d893f53283a8a4bdf0de1109ad3043a4a80329c3be9310bda73f35d6004c`
- teacher: `8050f60b8d0ffd4648d4b389b9d4c87a4ef5d3c40f464465ba413fe726c3d007`
- release: `a7d88e80dfa8f175ea204e9f7eff2ffa08966f8c3c4f3d0d8f3ee05809a2fa56`
- canonicalArtifactSha256: `0668b3c71468b75969a049ee90ac48a8a02dceb679a17e83b0e395b95b49c3dc`
- historicalVerify: `True`
- fileSha256: `77c72cd169f897b02b5f3ab599f9f7024937ffcfa8e707f59a3bd5bec527132a`

### historical-managed-drag-drop-rich-workbook.json

- commit: `12e5535805403d9a5f9f0466ca1911731f8d5f9d`
- component: `ultimate-b2-workbook`
- compiler: `ultimate-b2-workbook-v1`
- epoch: `rich`
- compatibility: `6f25da8e2c53085bb80d6507709ca9bb9658fdd077d074f05eef3fb83ee7c6ab`
- source: `04ad06a6f117694146e72307ffdf0b326c5f265f6dcba7e2fb1509d82ee3971f`
- public: `eee8ec44370a5c8710b4f7ae6a14cd57b190801f824dab25d8e5823049dad3a9`
- teacher: `dc7240013331bf8662cbfad4cc97b18cdad7f983ae664b89b9faff83bb1d9b7b`
- release: `c333a3e7c6213790b56abd1cd3fdfc3c8f1fe9f5298bacd3ea9a549cf4949847`
- canonicalArtifactSha256: `cf0bac0c995fdbc00246aaa4afb0e450c0f7b91fed1727a9c9beb3b3e1c96cf6`
- historicalVerify: `True`
- fileSha256: `a5a7287cb76061487453b38431d684022d61b2eed458e3f54e9368d3bc9db09d`


## Current compilation control

Before changing verification, the exact baseline `85a99c5a9138ba0c7c0f5bd082ce257b4910534f` compiler compiled the same font + multiline synthetic input with current activityOrder. The tests pin the entire canonical row (including every stored hash), not only its compatibility. Canonical artifact hashes: {"ultimate-b2-grammar-book": "773a95d559374bdaa01e737fd0ae6033be05202eaa4dd5f0660a812f57573207", "ultimate-b2-workbook": "d4e6165cf1adcd4b3eb2d6183fddbc1af33d3e1432ab4aeaa02a2b45bc2dd523"}.
