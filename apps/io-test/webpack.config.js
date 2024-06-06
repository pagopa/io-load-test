const path = require('path');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const GlobEntries = require('webpack-glob-entries');
const webpack = require('webpack')


module.exports = {
  mode: 'production',
  entry: GlobEntries('./src/*.ts'), // Generates multiple entry for each test
  output: {
    path: path.join(__dirname, 'dist'),
    libraryTarget: 'commonjs',
    filename: '[name].js'
  },
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      util: require.resolve("util/"),
      stream: require.resolve("stream-browserify"),
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ["@babel/env", "@babel/typescript"],
            plugins: ['@babel/plugin-proposal-class-properties', "@babel/proposal-object-rest-spread", "@babel/plugin-transform-async-generator-functions"]
          }
        },
        exclude: /node_modules/,
      },
    ],
  },
  target: "es6",
  externals: /^(k6(?!-)|https?\:\/\/)(\/.*)?/,
  // Generate map files for compiled scripts
  devtool: "source-map",
  stats: {
    colors: true,
  },
  plugins: [
    new CleanWebpackPlugin(),
    // Copy assets to the destination folder
    // see `src/post-file-test.ts` for an test example using an asset
    new CopyPlugin({
      patterns: [{ 
        from: path.resolve(__dirname, 'assets'), 
        noErrorOnMissing: true 
      }],
    }),
    new webpack.ProvidePlugin({
      process: 'process/browser',
    }),
  ],
  optimization: {
    // Don't minimize, as it's not used in the browser
    minimize: false,
  },
};