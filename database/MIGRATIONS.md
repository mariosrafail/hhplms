# Database migration order

Apply production migrations in this exact order:

1. `001_init_lms_demo.sql`
2. `002_basic_auth.sql`
3. `003_activities_assignments.sql`
4. `004_course_content.sql`
5. `005_word_search_activity.sql`
6. `006_book_content_platform.sql`
7. `007_teacher_classes.sql`
8. `008_english_journey_6_book_package.sql`
9. `009_book_page_hotspots.sql`
10. `010_assignment_live_flow.sql`
11. `010_assignment_mvp_metadata.sql`
12. `011_authorization_tenant_isolation.sql`
13. `013_authorization_phase2.sql`
14. `014_account_lifecycle.sql`
15. `015_account_lifecycle_hardening.sql`
16. `016_operations_readiness.sql`
17. `017_book_licensing.sql`
18. `018_book_assets.sql`
19. `019_ultimate_b2_unit2_normalized_activities.sql`
20. `020_ultimate_b2_unit2_recovered_activities.sql`
21. `021_ultimate_b2_unit1_recovered_activities.sql`
22. `022_ultimate_b2_students_book_assignment_modes.sql`
23. `023_demo_teacher_ultimate_b2_access.sql`
24. `024_book_asset_object_key_constraint.sql`
25. `025_lms_pilot_acceptance_hardening.sql`
26. `026_ultimate_b2_unit2_runtime_parity.sql`
27. `027_phase_one_ultimate_book_catalog.sql`
28. `028_platform_administration.sql`
29. `029_ordinary_auth_login_rate_limit.sql`
30. `030_platform_admin_login_rate_limit.sql`
31. `031_builder_developer_auth.sql`
32. `032_builder_component_authoring.sql`
33. `033_builder_open_response_imports.sql`
34. `034_builder_teacher_ui_asset_uploads.sql`
35. `035_builder_component_publication.sql`
36. `036_builder_native_activity_foundation.sql`
37. `037_builder_native_open_response_authoring.sql`
38. `038_builder_native_asset_reuse.sql`
39. `039_builder_component_publication_v2.sql`
40. `040_published_native_assignment_runtime.sql`
41. `041_homework_phase_one.sql`
42. `042_builder_native_activity_retirement.sql`
43. `043_builder_activity_lifecycle.sql`
44. `044_builder_unit_extra_asset_uploads.sql`
45. `045_builder_component_pages.sql`
46. `046_builder_component_pages_finalize_fix.sql`
47. `047_ultimate_b2_managed_component_units.sql`
48. `048_ultimate_b2_product_publication.sql`
49. `049_builder_publication_asset_pins.sql`
50. `050_builder_publication_role_scoped_asset_pins.sql`
51. `051_builder_page_deletion_lifecycle.sql`
52. `052_builder_page_unit_extras_preservation.sql`
53. `053_builder_page_lifecycle_completion.sql`
54. `054_builder_component_font_library.sql`
55. `055_builder_unit_extra_audio.sql`
56. `056_ultimate_b1_managed_package_shells.sql`
57. `057_builder_activity_order.sql`
58. `058_native_teacher_answer_assets.sql`
59. `059_published_assignment_book_locators.sql`
60. `060_students_book_page_expansion.sql`
61. `061_students_book_publication_v3.sql`
62. `062_b1_managed_publication.sql`

The two `010` files are historical, already-deployed migrations. Their duplicate number is resolved by this manifest rather than renaming applied files. New migrations must use a unique, increasing number.

`012_demo_login_passwords.sql` is intentionally excluded from production order. Apply it only after all production migrations on a local/demo database. It contains demo-only password hashes plus the repeatable Ultimate B2 pilot class, membership, student entitlement, and representative auto-scored and teacher-reviewed assignments.

After `013`, query `tenant_integrity_issues` and reconcile every non-zero row before treating tenant isolation as fully enforced. The migration applies `NOT NULL` only where existing rows are already safe; it never assigns unknown rows to the Hamilton House demo school.
