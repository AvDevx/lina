const express = require("express")
const { graphqlHTTP } = require("express-graphql")
const { buildSchema } = require("graphql")
const mongoose = require("mongoose")
const axios = require("axios")
require("dotenv").config()

const Order = require("./models/order.model")

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
	.then(() => console.log("MongoDB connected"))
	.catch((err) => console.error(err))

const graphqlSchema = `
enum Status {
    open
    closed
    picking
    picked
    packed
    shipped
    cancelled
}

  type ShippingAddress {
    verified: Boolean
    name: String
    company: String
    address_line1: String
    city: String
    state: String
    state_code: String
    country: String
    country_code: String
    zip: String
  }

  type Item {
    sku: String
    name: String
    total_qty: Int
    remaining_qty: Int
  }

  type Shipment {
    shipment_id: String
    carrier: String
    service: String
    tracking_number: String
  }

  type Order {
    id: ID!
    client_name: String
    code: Int
    status: Status
    created_at: String
    closed_at: String
    shipping_address: ShippingAddress
    items: [Item]
    shipments: [Shipment]
  }

  input FilterInput {
    client_name: String
    status: [Status]
    created_at_start: String
    created_at_end: String
    closed_at_start: String
    closed_at_end: String
    item_name: String
  }

  type Query {
    orders(filter: FilterInput): [Order]
    order(id: ID!): Order
  }`

// Define GraphQL Schema
const schema = buildSchema(graphqlSchema)

// Define Resolvers
const resolvers = {
	orders: async ({ filter }) => {
		const query = {}

		if (filter) {
			// Handle status filter
			if (filter.status) {
				query.status = { $in: filter.status }
			}

			// Handle other filters
			if (filter.client_name) {
				query.client_name = {
					$regex: filter.client_name,
					$options: "i",
				}
			}

			if (filter.created_at_start) {
				query.created_at = {
					$gte: new Date(filter.created_at_start),
				}
			}

			if (filter.created_at_end) {
				query.created_at.$lte = new Date(
					filter.created_at_end
				)
			}

			if (filter.closed_at_start) {
				query.closed_at = {
					$gte: new Date(filter.closed_at_start),
				}
			}

			if (filter.closed_at_end) {
				query.closed_at.$lte = new Date(
					filter.closed_at_end
				)
			}

			if (filter.item_name) {
				query["items.name"] = {
					$regex: filter.item_name,
					$options: "i",
				}
			}
		}

		console.log("Generated MongoDB query:", query)
		return await Order.find(query)
	},
}

// Create Express App
const app = express()
app.use(express.json())

app.use(
	"/graphql",
	graphqlHTTP({
		schema,
		rootValue: resolvers,
		graphiql: true,
	})
)

app.post("/generate-query", express.json(), async (req, res) => {
	const { userInput } = req.body

	if (!userInput) {
		return res.status(400).send({ error: "User input is required" })
	}

	const graphqlQuery = await generateGraphQLQuery(userInput)

	if (!graphqlQuery) {
		return res
			.status(500)
			.send({ error: "Failed to generate GraphQL query" })
	}

	res.send({ graphqlQuery })
})

// OpenAI Integration
const generateGraphQLQuery = async (userInput) => {
	try {
		const schemaContext = graphqlSchema

		const response = await axios.post(
			"https://api.openai.com/v1/chat/completions",
			{
				model: "gpt-3.5-turbo",
				messages: [
					{
						role: "system",
						content: `Todays date:${new Date()} You are an assistant that generates GraphQL queries matching the schema provided. Make sure all columns are visible from the schema user shall only control the filters. Don't add any extra headings make sure your response is like "query <then actual query goes here>"`,
					},
					{
						role: "user",
						content: `Schema:\n${schemaContext}\n\nGenerate a GraphQL query using a filter argument with the following conditions: ${JSON.stringify(
							userInput
						)}`,
					},
				],
			},
			{
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
				},
			}
		)

		// Extract and clean the query
		let graphqlQuery =
			response.data.choices[0].message.content.trim()

		// Ensure filter key is properly formatted
		graphqlQuery = graphqlQuery
			.replace(/```graphql/g, "")
			.replace(/```/g, "")
			.replace(/\n/g, " ")

		return graphqlQuery
	} catch (error) {
		console.error("Error generating GraphQL query:", error.message)
		return null
	}
}

app.post("/fetch-orders", express.json(), async (req, res) => {
	const { userInput } = req.body

	if (!userInput) {
		return res.status(400).send({ error: "User input is required" })
	}

	try {
		// Generate GraphQL Query
		const graphqlQuery = await generateGraphQLQuery(userInput)
		if (!graphqlQuery) {
			return res.status(500).send({
				error: "Failed to generate GraphQL query",
			})
		}
		console.log("Generated GraphQL Query:", graphqlQuery)

		// Send Query to GraphQL Server
		const response = await axios.post(
			`http://localhost:${PORT}/graphql`,
			{ query: graphqlQuery },
			{
				headers: { "Content-Type": "application/json" },
			}
		)

		// Return Fetched Data
		res.send({ data: response.data })
	} catch (error) {
		console.error("Error in fetching orders:", error.message)
		res.status(500).send({ error: "Failed to fetch orders" })
	}
})

// Start Server
const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}/graphql`)
})
