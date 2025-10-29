const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase credentials in environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Fetches market data from Supabase markets table
 * @returns {Promise<Array>} Array of market data objects
 */
async function fetchMarketData() {
  try {
    const { data, error } = await supabase
      .from("markets")
      .select(
        `
        symbol,
        name,
        market_address,
        market_id_bytes32,
        is_active,
        description,
        created_at
        `
      )
      .eq("is_active", true);

    if (error) throw error;

    if (!data || data.length === 0) {
      throw new Error("No active markets found in Supabase markets table");
    }

    return data.map((market) => ({
      symbol: market.symbol,
      name: market.name || market.symbol.split("-")[0],
      marketId: market.market_id_bytes32,
      orderBook: market.market_address, // Using market_address as the orderbook address
      active: market.is_active,
      description: market.description,
    }));
  } catch (error) {
    console.error("Error fetching market data from Supabase:", error.message);
    throw error;
  }
}

module.exports = {
  supabase,
  fetchMarketData,
};
