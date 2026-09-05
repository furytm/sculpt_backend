import swaggerJSDoc from "swagger-jsdoc";

const swaggerOptions: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.0",

    info: {
      title: "Sculpt Lab API",
      version: "1.0.0",
      description: "Sculpt Lab Backend API",
    },

    servers: [
      {
        url: "http://localhost:5000",
        description: "Local Development",
      },
      {
        url: "https://sculpt-backend-6flc.onrender.com",
        description: "Production",
      },
    ],

    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },

apis: [
  "./src/auth/*.ts",
  "./src/membership/*.ts",
  "./src/booking/*.ts",
  "./src/payment/*.ts",
  "./src/schedule/*.ts",
],
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);

export default swaggerSpec;