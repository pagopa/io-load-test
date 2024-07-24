module.exports = {
    apps : [{
      script    : "yarn",
      args      : "signer",
      instances : "max",
      exec_mode : "cluster"
    }]
  }