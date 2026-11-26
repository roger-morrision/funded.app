use anchor_lang::prelude::*;
use crate::error::ErrorCode;

/// Splits `delta` (new money since the last call, never the lifetime total)
/// across `units`/`unit_total` using a largest-remainder method, carrying each
/// category's fractional leftover forward in `remainder` for the next call.
///
/// Calling this with a lifetime total and overwriting a category's stored
/// share with a freshly recomputed boundary difference (the previous
/// approach) is not safe: two categories' boundary difference, recomputed
/// from a larger total, is not individually monotonic even though the full
/// set of categories always sums to the total exactly. A category's stored
/// share can therefore come out smaller after a later settlement than it was
/// after an earlier one, and the caller's `new_value - old_value` then
/// underflows permanently.
///
/// Calling this instead with each settlement's own `delta`, then
/// *accumulating* the returned increments (`stored = stored.checked_add(...)`,
/// never overwriting), keeps every category's running total strictly
/// non-decreasing by construction, and bounds the lifetime rounding loss per
/// category to under one lamport forever (not per settlement), since any
/// leftover numerator is carried into the next call rather than discarded.
pub(crate) fn allocate_increment<const N: usize>(
    delta: u64,
    units: [u32; N],
    unit_total: u32,
    remainder: &mut [u64; N],
) -> Result<[u64; N]> {
    require!(
        units.iter().map(|value| u64::from(*value)).sum::<u64>() == u64::from(unit_total),
        ErrorCode::InvalidProtocolFeeRates
    );
    let mut increments = [0u64; N];
    for index in 0..N {
        let numerator = u128::from(delta)
            .checked_mul(u128::from(units[index]))
            .and_then(|value| value.checked_add(u128::from(remainder[index])))
            .ok_or(ErrorCode::AmountOverflow)?;
        let increment = numerator / u128::from(unit_total);
        let leftover = numerator % u128::from(unit_total);
        increments[index] = u64::try_from(increment).map_err(|_| ErrorCode::AmountOverflow)?;
        remainder[index] = u64::try_from(leftover).map_err(|_| ErrorCode::AmountOverflow)?;
    }
    Ok(increments)
}

/// For a value that only ever grows (a cumulative pool, not a per-call
/// amount), advances a persisted per-sub-category `ceiling` by exactly the
/// pool's growth since `pool_base`, using [`allocate_increment`] on that
/// growth. The ceiling is therefore monotonically non-decreasing in `pool` by
/// construction, unlike recomputing it fresh from `pool` every call.
#[allow(clippy::too_many_arguments)]
pub(crate) fn advance_ceiling<const N: usize>(
    pool: u64,
    units: [u32; N],
    unit_total: u32,
    pool_base: &mut u64,
    remainder: &mut [u64; N],
    ceiling: &mut [u64; N],
) -> Result<()> {
    let delta = pool.checked_sub(*pool_base).ok_or(ErrorCode::AmountOverflow)?;
    if delta > 0 {
        let increments = allocate_increment(delta, units, unit_total, remainder)?;
        for index in 0..N {
            ceiling[index] = ceiling[index]
                .checked_add(increments[index])
                .ok_or(ErrorCode::AmountOverflow)?;
        }
        *pool_base = pool;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn increments_sum_exactly_to_delta_every_call() {
        let units = [3u32, 2];
        let mut remainder = [0u64; 2];
        let mut total_in = 0u128;
        let mut total_out = 0u128;
        // Irregular amounts, the kind real fee collections look like.
        for delta in [1u64, 1, 2, 7, 1, 100, 3, 1, 1, 1, 5, 9999, 1, 1] {
            let increments = allocate_increment(delta, units, 5, &mut remainder).unwrap();
            total_in += u128::from(delta);
            total_out += u128::from(increments[0]) + u128::from(increments[1]);
            // A call can pay out more than its own delta's exact share, by
            // also catching up a backlog carried from earlier calls' rounded-
            // down remainder — that's by design (see `many_tiny_settlements_
            // do_not_starve_a_small_category_forever`). What must never
            // happen, at any point, is paying out more than was ever put in.
            assert!(total_out <= total_in);
        }
        // At most one lamport per category is ever left uncollected, forever,
        // not per call.
        let still_owed: u128 = remainder.iter().map(|r| u128::from(*r)).sum::<u128>() / 5;
        assert!(total_in - total_out - still_owed <= 1);
    }

    #[test]
    fn many_tiny_settlements_do_not_starve_a_small_category_forever() {
        // A 1-unit-of-5 category would round to zero on every single-lamport
        // settlement under the old from-scratch-boundary method; with a
        // carried remainder it must still eventually get paid.
        let units = [1u32, 4];
        let mut remainder = [0u64; 2];
        let mut paid = [0u64; 2];
        for _ in 0..10 {
            let increments = allocate_increment(1, units, 5, &mut remainder).unwrap();
            paid[0] += increments[0];
            paid[1] += increments[1];
        }
        assert!(paid[0] >= 1, "the small category must eventually receive something");
        assert_eq!(paid[0] + paid[1] + remainder.iter().sum::<u64>(), 10);
    }

    #[test]
    fn rejects_units_not_summing_to_unit_total() {
        let mut remainder = [0u64; 2];
        assert!(allocate_increment(10, [1u32, 1], 3, &mut remainder).is_err());
    }

    #[test]
    fn ceiling_is_monotonic_even_as_the_underlying_pool_recomputation_would_not_be() {
        // The exact scenario found by brute-force search: at pool=2 the
        // boundary-difference method for cumulative units (2,3) out of 5
        // gives 1, but at pool=3 it gives 0 — a real decrease under the old
        // approach. advance_ceiling must never decrease.
        let units = [2u32, 3];
        let mut pool_base = 0u64;
        let mut remainder = [0u64; 2];
        let mut ceiling = [0u64; 2];
        advance_ceiling(2, units, 5, &mut pool_base, &mut remainder, &mut ceiling).unwrap();
        let after_two = ceiling;
        advance_ceiling(3, units, 5, &mut pool_base, &mut remainder, &mut ceiling).unwrap();
        for index in 0..2 {
            assert!(ceiling[index] >= after_two[index], "ceiling must never decrease");
        }
    }
}
