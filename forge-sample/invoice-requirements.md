# Invoice rules: sample requirements

These are the rules for a small invoicing tool. They are a sample for trying FORGE.

## Discounts

- The system shall give no discount on invoices below 1,000 EUR.
- The system shall apply a 5% discount to invoices from 1,000 EUR up to 4,999.99 EUR.
- The system shall apply a 10% discount to invoices of 5,000 EUR or more.

## VAT and totals

- The system shall charge VAT at 20% of the amount after discount.
- The system shall round every amount to 2 decimal places.

## Payment terms

- The invoice due date shall be 30 days after the invoice date.
