-- Short, catalogue-facing description — shown in the product detail
-- view on the public shop page (app/shop/[slug]/ShopCart.jsx) when a
-- customer taps a product. Optional, plain text (no formatting needed
-- for something this short), applies to both products and services
-- since either can appear in the catalogue.
alter table products add column description text;
